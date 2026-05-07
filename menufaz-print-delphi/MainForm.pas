unit MainForm;

interface

uses
  System.SysUtils, System.Classes, System.JSON, System.IOUtils, System.UITypes,
  System.Generics.Collections, System.Net.URLClient, System.Net.HttpClient,
  System.NetEncoding, Winapi.Windows, Winapi.Messages, Winapi.WinSpool,
  Winapi.ShellAPI, System.Win.Registry, System.StrUtils,
  Vcl.Forms, Vcl.Controls, Vcl.StdCtrls, Vcl.ExtCtrls,
  Vcl.ComCtrls, Vcl.Dialogs, Vcl.Graphics, Vcl.Menus, Vcl.Printers,
  Vcl.Imaging.pngimage, AdvAppStyler, AdvStyleIF;

type
  TStation = record
    Id: string;
    Name: string;
  end;

  TPrintJob = record
    Id: string;
    PrintText: string;
    StationId: string;
  end;

  TMainForm = class(TForm)
  private
    FConfigPath: string;
    FLogPath: string;
    FProcessedPath: string;
    FMerchantId: string;
    FMachineId: string;
    FApiUrl: string;
    FStoreName: string;
    FPrintToken: string;
    FPrinterName: string;
    FUseStationRouting: Boolean;
    FAutoLaunch: Boolean;
    FStations: TArray<TStation>;
    FAssignedStations: TStringList;
    FStationPrinters: TDictionary<string, string>;
    FProcessedJobs: TDictionary<string, TDateTime>;
    FPolling: Boolean;
    FProcessing: Boolean;
    FLastError: string;
    FLastPrintedAt: string;
    FLastPrintedId: string;
    FConnected: Boolean;
    FHealth: string;
    FCurrentStatus: string;
    FClosingToTray: Boolean;
    FMutex: THandle;

    AdvAppStyler1: TAdvAppStyler;
    AdvFormStyler1: TAdvFormStyler;

    TrayIcon: TTrayIcon;
    TrayMenu: TPopupMenu;
    PollTimer: TTimer;
    RootPanel: TScrollBox;
    HeaderPanel: TPanel;
    CommPanel: TPanel;
    LblCommTitle: TLabel;
    LblCommDetail: TLabel;
    LblStoreName: TLabel;
    LblMerchant: TLabel;
    LblApi: TLabel;
    EdMerchant: TEdit;
    EdApi: TEdit;
    BtnSave: TButton;
    BtnReset: TButton;
    CbAutoStart: TCheckBox;
    RbMainPrinter: TRadioButton;
    RbStationRouting: TRadioButton;
    CbPrinters: TComboBox;
    BtnRefreshPrinters: TButton;
    BtnTest: TButton;
    StationPanel: TPanel;
    LblConnected: TLabel;
    LblStatus: TLabel;
    LblHealth: TLabel;
    LblLastPrinted: TLabel;
    LblLastError: TLabel;
    LblLog: TLabel;

    procedure BuildUi;
    procedure AddInfoRow(AParent: TWinControl; const ACaption: string; AValueLabel: TLabel);
    procedure SaveConfig;
    procedure LoadConfig;
    procedure EnsureDefaults;
    procedure LoadProcessedJobs;
    procedure SaveProcessedJobs;
    procedure TrimProcessedJobs;
    procedure Log(const Level, Msg: string);
    procedure SetStatus(const CurrentStatus, Health, LastError: string; Connected: Boolean);
    procedure UpdateUi;
    procedure UpdateCommunicationVisual;
    procedure RefreshPrinters;
    procedure RebuildStationPanel;
    procedure RegisterMachine;
    procedure StartPolling;
    procedure StopPolling;
    procedure PollTimerTick(Sender: TObject);
    procedure PollJobs;
    procedure ProcessJobs(const Jobs: TArray<TPrintJob>);
    procedure PrintJob(const Job: TPrintJob);
    procedure MarkPrinted(const JobId: string);
    procedure MarkFailed(const JobId, Reason: string; Retry: Boolean);
    procedure ApiRequest(const Endpoint, Method, Body, Token: string; out ResponseText: string);
    function ResolveJobPrinter(const Job: TPrintJob): string;
    function EncodePrintText(const Text: string): TBytes;
    function BuildEscPosPayload(const Text: string): TBytes;
    procedure RawPrint(const PrinterName: string; const Data: TBytes);
    function NormalizeStationId(const Value: string): string;
    function StationExists(const StationId: string): Boolean;
    function GetStationPrinter(const StationId: string): string;
    procedure SetStationPrinter(const StationId, PrinterName: string);
    function IsAssignedStation(const StationId: string): Boolean;
    procedure SetAssignedStation(const StationId: string; Assigned: Boolean);
    function AssignedStationsJson: TJSONArray;
    function StationsJson: TJSONArray;
    function StationPrintersJson: TJSONObject;
    procedure ApplyAutoStart;
    function AutoStartEnabled: Boolean;
    procedure SetAutoStartEnabled(Enabled: Boolean);
    procedure SaveClick(Sender: TObject);
    procedure ResetClick(Sender: TObject);
    procedure RefreshPrintersClick(Sender: TObject);
    procedure TestPrintClick(Sender: TObject);
    procedure AutoStartClick(Sender: TObject);
    procedure ModeClick(Sender: TObject);
    procedure PrinterChange(Sender: TObject);
    procedure StationAssignedClick(Sender: TObject);
    procedure StationPrinterChange(Sender: TObject);
    procedure TrayOpenClick(Sender: TObject);
    procedure TrayExitClick(Sender: TObject);
    procedure FormCloseQuery(Sender: TObject; var CanClose: Boolean);
    procedure FormDestroy(Sender: TObject);
  public
    constructor Create(AOwner: TComponent); override;
  end;

var
  FrmMain: TMainForm;

implementation

{$R *.dfm}

const
  DEFAULT_API_URL = 'https://app.menufaz.com';
  POLL_INTERVAL_MS = 5000;
  REQUEST_TIMEOUT_MS = 12000;
  PROCESSED_TTL_DAYS = 0.25; // 6 hours

function JsonString(Obj: TJSONObject; const Name, Default: string): string;
var
  Value: TJSONValue;
begin
  Result := Default;
  if Obj = nil then
    Exit;
  Value := Obj.GetValue(Name);
  if Value <> nil then
    Result := Value.Value;
end;

function JsonBool(Obj: TJSONObject; const Name: string; Default: Boolean): Boolean;
var
  Value: TJSONValue;
begin
  Result := Default;
  if Obj = nil then
    Exit;
  Value := Obj.GetValue(Name);
  if Value <> nil then
    Result := SameText(Value.Value, 'true') or (Value.Value = '1');
end;

function NewGuidString: string;
var
  G: TGUID;
begin
  CreateGUID(G);
  Result := GUIDToString(G);
  Result := Copy(Result, 2, Length(Result) - 2);
end;

constructor TMainForm.Create(AOwner: TComponent);
begin
  inherited Create(AOwner);
  FMutex := CreateMutex(nil, True, 'MenufazPrintDelphiSingleInstance');
  if (FMutex <> 0) and (GetLastError = ERROR_ALREADY_EXISTS) then
  begin
    MessageDlg('Menufaz Print ja esta em execucao.', mtInformation, [mbOK], 0);
    Halt;
  end;

  FAssignedStations := TStringList.Create;
  FAssignedStations.CaseSensitive := False;
  FStationPrinters := TDictionary<string, string>.Create;
  FProcessedJobs := TDictionary<string, TDateTime>.Create;
  AdvAppStyler1 := TAdvAppStyler.Create(Self);
  AdvAppStyler1.Style := tsOffice2016White;
  AdvFormStyler1 := TAdvFormStyler.Create(Self);
  AdvFormStyler1.AppStyle := AdvAppStyler1;
  AdvFormStyler1.Style := tsOffice2016White;
  BuildUi;
  LoadConfig;
  LoadProcessedJobs;
  RefreshPrinters;
  UpdateUi;
  RegisterMachine;
  StartPolling;
end;

procedure TMainForm.BuildUi;
var
  Item: TMenuItem;
  Panel: TPanel;
  StatusPanel: TPanel;
begin
  Caption := 'Menufaz Print';
  Width := 680;
  Height := 820;
  Position := poScreenCenter;
  OnCloseQuery := FormCloseQuery;
  OnDestroy := FormDestroy;

  TrayMenu := TPopupMenu.Create(Self);
  Item := TMenuItem.Create(TrayMenu);
  Item.Caption := 'Abrir';
  Item.OnClick := TrayOpenClick;
  TrayMenu.Items.Add(Item);
  Item := TMenuItem.Create(TrayMenu);
  Item.Caption := 'Sair';
  Item.OnClick := TrayExitClick;
  TrayMenu.Items.Add(Item);

  TrayIcon := TTrayIcon.Create(Self);
  TrayIcon.Hint := 'Menufaz Print';
  TrayIcon.PopupMenu := TrayMenu;
  TrayIcon.Visible := True;
  TrayIcon.Icon.Assign(Application.Icon);
  TrayIcon.OnDblClick := TrayOpenClick;

  RootPanel := TScrollBox.Create(Self);
  RootPanel.Parent := Self;
  RootPanel.Align := alClient;
  RootPanel.BorderStyle := bsNone;
  RootPanel.Color := $00F8FAFC;
  RootPanel.ParentColor := False;
  RootPanel.VertScrollBar.Tracking := True;

  HeaderPanel := TPanel.Create(Self);
  HeaderPanel.Parent := RootPanel;
  HeaderPanel.Align := alTop;
  HeaderPanel.Height := 150;
  HeaderPanel.BevelOuter := bvNone;
  HeaderPanel.Color := $00EAF2FF;
  HeaderPanel.ParentBackground := False;
  HeaderPanel.Padding.SetBounds(16, 14, 16, 10);
  with TLabel.Create(Self) do
  begin
    Parent := HeaderPanel;
    Caption := 'Menufaz Print';
    Font.Size := 18;
    Font.Style := [fsBold];
    Font.Color := $006B3F00;
    Left := 16;
    Top := 14;
  end;
  with TLabel.Create(Self) do
  begin
    Parent := HeaderPanel;
    Caption := 'Agente local Windows para impressao automatica RAW';
    Left := 18;
    Top := 50;
    Width := 620;
  end;
  LblHealth := TLabel.Create(Self);
  LblHealth.Parent := HeaderPanel;
  LblHealth.Left := 18;
  LblHealth.Top := 122;
  LblHealth.Font.Style := [fsBold];

  CommPanel := TPanel.Create(Self);
  CommPanel.Parent := HeaderPanel;
  CommPanel.Left := 16;
  CommPanel.Top := 78;
  CommPanel.Width := 628;
  CommPanel.Height := 34;
  CommPanel.BevelOuter := bvNone;
  CommPanel.Color := $00D1FAE5;
  CommPanel.ParentBackground := False;

  LblCommTitle := TLabel.Create(Self);
  LblCommTitle.Parent := CommPanel;
  LblCommTitle.Left := 12;
  LblCommTitle.Top := 7;
  LblCommTitle.Width := 190;
  LblCommTitle.Caption := 'Comunicacao aguardando';
  LblCommTitle.Font.Style := [fsBold];
  LblCommTitle.Font.Color := $00065F46;

  LblCommDetail := TLabel.Create(Self);
  LblCommDetail.Parent := CommPanel;
  LblCommDetail.Left := 210;
  LblCommDetail.Top := 7;
  LblCommDetail.Width := 400;
  LblCommDetail.Caption := 'Informe o Merchant ID para registrar o agente.';
  LblCommDetail.Font.Color := $00065F46;

  Panel := TPanel.Create(Self);
  Panel.Parent := RootPanel;
  Panel.Align := alTop;
  Panel.Height := 120;
  Panel.Color := clWhite;
  Panel.ParentBackground := False;
  Panel.Padding.SetBounds(16, 8, 16, 8);
  LblStoreName := TLabel.Create(Self);
  AddInfoRow(Panel, 'Loja', LblStoreName);
  LblMerchant := TLabel.Create(Self);
  AddInfoRow(Panel, 'Merchant ID', LblMerchant);
  LblApi := TLabel.Create(Self);
  AddInfoRow(Panel, 'API URL', LblApi);

  Panel := TPanel.Create(Self);
  Panel.Parent := RootPanel;
  Panel.Align := alTop;
  Panel.Height := 176;
  Panel.Color := clWhite;
  Panel.ParentBackground := False;
  Panel.Padding.SetBounds(16, 8, 16, 8);
  with TLabel.Create(Self) do
  begin
    Parent := Panel;
    Caption := 'Setup';
    Font.Style := [fsBold];
    Left := 16;
    Top := 10;
  end;
  EdMerchant := TEdit.Create(Self);
  EdMerchant.Parent := Panel;
  EdMerchant.Left := 16;
  EdMerchant.Top := 36;
  EdMerchant.Width := 620;
  EdMerchant.TextHint := 'Merchant ID';
  EdApi := TEdit.Create(Self);
  EdApi.Parent := Panel;
  EdApi.Left := 16;
  EdApi.Top := 66;
  EdApi.Width := 620;
  EdApi.TextHint := DEFAULT_API_URL;
  BtnSave := TButton.Create(Self);
  BtnSave.Parent := Panel;
  BtnSave.Caption := 'Salvar e registrar';
  BtnSave.Left := 16;
  BtnSave.Top := 102;
  BtnSave.Width := 150;
  BtnSave.OnClick := SaveClick;
  BtnReset := TButton.Create(Self);
  BtnReset.Parent := Panel;
  BtnReset.Caption := 'Resetar configuracao';
  BtnReset.Left := 176;
  BtnReset.Top := 102;
  BtnReset.Width := 150;
  BtnReset.OnClick := ResetClick;
  CbAutoStart := TCheckBox.Create(Self);
  CbAutoStart.Parent := Panel;
  CbAutoStart.Caption := 'Iniciar com o Windows';
  CbAutoStart.Left := 16;
  CbAutoStart.Top := 136;
  CbAutoStart.OnClick := AutoStartClick;

  Panel := TPanel.Create(Self);
  Panel.Parent := RootPanel;
  Panel.Align := alTop;
  Panel.Height := 158;
  Panel.Color := clWhite;
  Panel.ParentBackground := False;
  Panel.Padding.SetBounds(16, 8, 16, 8);
  with TLabel.Create(Self) do
  begin
    Parent := Panel;
    Caption := 'Impressoras';
    Font.Style := [fsBold];
    Left := 16;
    Top := 10;
  end;
  RbMainPrinter := TRadioButton.Create(Self);
  RbMainPrinter.Parent := Panel;
  RbMainPrinter.Caption := 'Usar somente a impressora principal';
  RbMainPrinter.Left := 16;
  RbMainPrinter.Top := 34;
  RbMainPrinter.Width := 600;
  RbMainPrinter.OnClick := ModeClick;
  RbStationRouting := TRadioButton.Create(Self);
  RbStationRouting.Parent := Panel;
  RbStationRouting.Caption := 'Usar roteamento por estacao';
  RbStationRouting.Left := 16;
  RbStationRouting.Top := 58;
  RbStationRouting.Width := 600;
  RbStationRouting.OnClick := ModeClick;
  CbPrinters := TComboBox.Create(Self);
  CbPrinters.Parent := Panel;
  CbPrinters.Left := 16;
  CbPrinters.Top := 88;
  CbPrinters.Width := 470;
  CbPrinters.Style := csDropDownList;
  CbPrinters.OnChange := PrinterChange;
  BtnRefreshPrinters := TButton.Create(Self);
  BtnRefreshPrinters.Parent := Panel;
  BtnRefreshPrinters.Caption := 'Atualizar';
  BtnRefreshPrinters.Left := 500;
  BtnRefreshPrinters.Top := 86;
  BtnRefreshPrinters.Width := 96;
  BtnRefreshPrinters.OnClick := RefreshPrintersClick;
  BtnTest := TButton.Create(Self);
  BtnTest.Parent := Panel;
  BtnTest.Caption := 'Imprimir teste';
  BtnTest.Left := 16;
  BtnTest.Top := 116;
  BtnTest.Width := 120;
  BtnTest.OnClick := TestPrintClick;

  StationPanel := TPanel.Create(Self);
  StationPanel.Parent := RootPanel;
  StationPanel.Align := alTop;
  StationPanel.Height := 132;
  StationPanel.Color := clWhite;
  StationPanel.ParentBackground := False;
  StationPanel.Padding.SetBounds(16, 8, 16, 8);

  StatusPanel := TPanel.Create(Self);
  StatusPanel.Parent := RootPanel;
  StatusPanel.Align := alTop;
  StatusPanel.Height := 184;
  StatusPanel.Color := clWhite;
  StatusPanel.ParentBackground := False;
  StatusPanel.Padding.SetBounds(16, 8, 16, 8);
  LblConnected := TLabel.Create(Self);
  AddInfoRow(StatusPanel, 'Conectado', LblConnected);
  LblStatus := TLabel.Create(Self);
  AddInfoRow(StatusPanel, 'Status atual', LblStatus);
  LblLastPrinted := TLabel.Create(Self);
  AddInfoRow(StatusPanel, 'Ultima impressao', LblLastPrinted);
  LblLastError := TLabel.Create(Self);
  AddInfoRow(StatusPanel, 'Ultimo erro', LblLastError);
  LblLog := TLabel.Create(Self);
  AddInfoRow(StatusPanel, 'Log', LblLog);

  PollTimer := TTimer.Create(Self);
  PollTimer.Interval := POLL_INTERVAL_MS;
  PollTimer.Enabled := False;
  PollTimer.OnTimer := PollTimerTick;

  if Assigned(AdvAppStyler1) then
    AdvAppStyler1.ApplyStyle;
end;

procedure TMainForm.AddInfoRow(AParent: TWinControl; const ACaption: string; AValueLabel: TLabel);
var
  RowTop: Integer;
begin
  RowTop := 12 + (AParent.ControlCount div 2) * 28;
  with TLabel.Create(Self) do
  begin
    Parent := AParent;
    Caption := ACaption + ':';
    Left := 16;
    Top := RowTop;
    Width := 110;
    Font.Style := [fsBold];
  end;
  AValueLabel.Parent := AParent;
  AValueLabel.Left := 148;
  AValueLabel.Top := RowTop;
  AValueLabel.Width := 490;
  AValueLabel.Caption := '-';
end;

procedure TMainForm.EnsureDefaults;
begin
  if FApiUrl = '' then
    FApiUrl := DEFAULT_API_URL;
  if FMachineId = '' then
    FMachineId := NewGuidString;
  if Length(FStations) = 0 then
  begin
    SetLength(FStations, 3);
    FStations[0].Id := 'caixa';
    FStations[0].Name := 'Caixa';
    FStations[1].Id := 'bar';
    FStations[1].Name := 'Bar';
    FStations[2].Id := 'cozinha';
    FStations[2].Name := 'Cozinha';
  end;
  if FAssignedStations.Count = 0 then
  begin
    FAssignedStations.Add('caixa');
    FAssignedStations.Add('bar');
    FAssignedStations.Add('cozinha');
  end;
end;

procedure TMainForm.LoadConfig;
var
  BaseDir: string;
  JsonText: string;
  Value: TJSONValue;
  Obj, StationObj, MapObj: TJSONObject;
  Arr: TJSONArray;
  I: Integer;
  Pair: TJSONPair;
begin
  BaseDir := IncludeTrailingPathDelimiter(GetEnvironmentVariable('APPDATA')) + 'Menufaz Print';
  ForceDirectories(BaseDir);
  FConfigPath := IncludeTrailingPathDelimiter(BaseDir) + 'config.json';
  FLogPath := IncludeTrailingPathDelimiter(BaseDir) + 'app.log';
  FProcessedPath := IncludeTrailingPathDelimiter(BaseDir) + 'processed-jobs.json';
  FApiUrl := DEFAULT_API_URL;
  FUseStationRouting := False;
  FHealth := 'DEGRADED';
  FCurrentStatus := 'Idle';
  FAssignedStations.Clear;
  FStationPrinters.Clear;

  if FileExists(FConfigPath) then
  begin
    JsonText := TFile.ReadAllText(FConfigPath, TEncoding.UTF8);
    Value := TJSONObject.ParseJSONValue(JsonText);
    try
      Obj := Value as TJSONObject;
      if Obj <> nil then
      begin
        FMerchantId := JsonString(Obj, 'merchantId', '');
        FMachineId := JsonString(Obj, 'machineId', '');
        FApiUrl := JsonString(Obj, 'apiUrl', DEFAULT_API_URL);
        FStoreName := JsonString(Obj, 'storeName', '');
        FPrintToken := JsonString(Obj, 'printToken', '');
        FPrinterName := JsonString(Obj, 'printerName', '');
        FUseStationRouting := JsonBool(Obj, 'useStationRouting', False);
        FAutoLaunch := JsonBool(Obj, 'autoLaunchEnabled', AutoStartEnabled);
        Arr := Obj.GetValue('printerStations') as TJSONArray;
        if Arr <> nil then
        begin
          SetLength(FStations, Arr.Count);
          for I := 0 to Arr.Count - 1 do
          begin
            StationObj := Arr.Items[I] as TJSONObject;
            if StationObj <> nil then
            begin
              FStations[I].Id := NormalizeStationId(JsonString(StationObj, 'id', JsonString(StationObj, 'name', '')));
              FStations[I].Name := JsonString(StationObj, 'name', FStations[I].Id);
            end;
          end;
        end;
        Arr := Obj.GetValue('assignedStationIds') as TJSONArray;
        if Arr <> nil then
          for I := 0 to Arr.Count - 1 do
            if StationExists(NormalizeStationId(Arr.Items[I].Value)) then
              FAssignedStations.Add(NormalizeStationId(Arr.Items[I].Value));
        MapObj := Obj.GetValue('stationPrinters') as TJSONObject;
        if MapObj <> nil then
          for Pair in MapObj do
            if StationExists(NormalizeStationId(Pair.JsonString.Value)) then
              FStationPrinters.AddOrSetValue(NormalizeStationId(Pair.JsonString.Value), Pair.JsonValue.Value);
      end;
    finally
      Value.Free;
    end;
  end
  else
    FAutoLaunch := AutoStartEnabled;
  EnsureDefaults;
  SaveConfig;
end;

procedure TMainForm.SaveConfig;
var
  Obj: TJSONObject;
begin
  Obj := TJSONObject.Create;
  try
    Obj.AddPair('merchantId', FMerchantId);
    Obj.AddPair('machineId', FMachineId);
    Obj.AddPair('apiUrl', FApiUrl);
    Obj.AddPair('storeName', FStoreName);
    Obj.AddPair('printToken', FPrintToken);
    Obj.AddPair('printerName', FPrinterName);
    Obj.AddPair('useStationRouting', TJSONBool.Create(FUseStationRouting));
    Obj.AddPair('autoLaunchEnabled', TJSONBool.Create(FAutoLaunch));
    Obj.AddPair('printBackend', 'native');
    Obj.AddPair('printerStations', StationsJson);
    Obj.AddPair('assignedStationIds', AssignedStationsJson);
    Obj.AddPair('stationPrinters', StationPrintersJson);
    TFile.WriteAllText(FConfigPath, Obj.ToString, TEncoding.UTF8);
  finally
    Obj.Free;
  end;
end;

function TMainForm.StationsJson: TJSONArray;
var
  I: Integer;
  Obj: TJSONObject;
begin
  Result := TJSONArray.Create;
  for I := 0 to High(FStations) do
  begin
    Obj := TJSONObject.Create;
    Obj.AddPair('id', FStations[I].Id);
    Obj.AddPair('name', FStations[I].Name);
    Result.AddElement(Obj);
  end;
end;

function TMainForm.AssignedStationsJson: TJSONArray;
var
  I: Integer;
begin
  Result := TJSONArray.Create;
  for I := 0 to FAssignedStations.Count - 1 do
    Result.Add(FAssignedStations[I]);
end;

function TMainForm.StationPrintersJson: TJSONObject;
var
  Pair: TPair<string, string>;
begin
  Result := TJSONObject.Create;
  for Pair in FStationPrinters do
    Result.AddPair(Pair.Key, Pair.Value);
end;

procedure TMainForm.LoadProcessedJobs;
var
  Text: string;
  Value: TJSONValue;
  Obj: TJSONObject;
  Pair: TJSONPair;
  Timestamp: TDateTime;
begin
  FProcessedJobs.Clear;
  if not FileExists(FProcessedPath) then
    Exit;
  Text := TFile.ReadAllText(FProcessedPath, TEncoding.UTF8);
  Value := TJSONObject.ParseJSONValue(Text);
  try
    Obj := Value as TJSONObject;
    if Obj = nil then
      Exit;
    for Pair in Obj do
      if TryStrToFloat(Pair.JsonValue.Value, Double(Timestamp)) then
        FProcessedJobs.AddOrSetValue(Pair.JsonString.Value, Timestamp);
  finally
    Value.Free;
  end;
  TrimProcessedJobs;
end;

procedure TMainForm.SaveProcessedJobs;
var
  Obj: TJSONObject;
  Pair: TPair<string, TDateTime>;
begin
  TrimProcessedJobs;
  Obj := TJSONObject.Create;
  try
    for Pair in FProcessedJobs do
      Obj.AddPair(Pair.Key, FloatToStr(Pair.Value));
    TFile.WriteAllText(FProcessedPath, Obj.ToString, TEncoding.UTF8);
  finally
    Obj.Free;
  end;
end;

procedure TMainForm.TrimProcessedJobs;
var
  Keys: TStringList;
  Pair: TPair<string, TDateTime>;
  I: Integer;
begin
  Keys := TStringList.Create;
  try
    for Pair in FProcessedJobs do
      if Now - Pair.Value > PROCESSED_TTL_DAYS then
        Keys.Add(Pair.Key);
    for I := 0 to Keys.Count - 1 do
      FProcessedJobs.Remove(Keys[I]);
  finally
    Keys.Free;
  end;
end;

procedure TMainForm.Log(const Level, Msg: string);
var
  Line: string;
begin
  Line := Format('[%s] [%s] %s', [FormatDateTime('yyyy-mm-dd"T"hh:nn:ss.zzz', Now), Level, Msg]) + sLineBreak;
  TFile.AppendAllText(FLogPath, Line, TEncoding.UTF8);
end;

procedure TMainForm.SetStatus(const CurrentStatus, Health, LastError: string; Connected: Boolean);
begin
  if CurrentStatus <> '' then
    FCurrentStatus := CurrentStatus;
  if Health <> '' then
    FHealth := Health;
  FLastError := LastError;
  FConnected := Connected;
  TThread.Synchronize(nil,
    procedure
    begin
      UpdateUi;
    end);
end;

procedure TMainForm.UpdateUi;
var
  I: Integer;
begin
  LblStoreName.Caption := IfThen(FStoreName <> '', FStoreName, 'Nao conectada');
  LblMerchant.Caption := IfThen(FMerchantId <> '', FMerchantId, '-');
  LblApi.Caption := FApiUrl;
  EdMerchant.Text := FMerchantId;
  EdApi.Text := FApiUrl;
  CbAutoStart.Checked := FAutoLaunch;
  RbMainPrinter.Checked := not FUseStationRouting;
  RbStationRouting.Checked := FUseStationRouting;
  LblConnected.Caption := IfThen(FConnected, 'Sim', 'Nao');
  LblStatus.Caption := FCurrentStatus;
  LblHealth.Caption := FHealth;
  LblLastPrinted.Caption := IfThen(FLastPrintedAt <> '', FLastPrintedAt + ' (' + FLastPrintedId + ')', '-');
  LblLastError.Caption := IfThen(FLastError <> '', FLastError, '-');
  LblLog.Caption := FLogPath;
  UpdateCommunicationVisual;
  for I := 0 to CbPrinters.Items.Count - 1 do
    if SameText(CbPrinters.Items[I], FPrinterName) then
    begin
      CbPrinters.ItemIndex := I;
      Break;
    end;
  RebuildStationPanel;
end;

procedure TMainForm.UpdateCommunicationVisual;
begin
  if not Assigned(CommPanel) then
    Exit;

  if FConnected and SameText(FHealth, 'HEALTHY') and (FLastError = '') then
  begin
    CommPanel.Color := $00D1FAE5;
    LblCommTitle.Caption := 'Menufaz conectado';
    LblCommDetail.Caption := IfThen(FStoreName <> '', 'Comunicacao ativa com ' + FStoreName, 'API respondendo normalmente.');
    LblCommTitle.Font.Color := $00065F46;
    LblCommDetail.Font.Color := $00065F46;
    LblHealth.Font.Color := $00065F46;
    Exit;
  end;

  if SameText(FHealth, 'ERROR') or (FLastError <> '') then
  begin
    CommPanel.Color := $00E6D5FF;
    LblCommTitle.Caption := 'Atencao na comunicacao';
    LblCommDetail.Caption := IfThen(FLastError <> '', FLastError, 'Verifique conexao, Merchant ID ou impressora.');
    LblCommTitle.Font.Color := $003B0764;
    LblCommDetail.Font.Color := $003B0764;
    LblHealth.Font.Color := $003B0764;
    Exit;
  end;

  CommPanel.Color := $00FEF3C7;
  LblCommTitle.Caption := 'Aguardando Menufaz';
  LblCommDetail.Caption := IfThen(FMerchantId <> '', 'Tentando registrar e sincronizar com a API.', 'Informe o Merchant ID para registrar o agente.');
  LblCommTitle.Font.Color := $00924516;
  LblCommDetail.Font.Color := $00924516;
  LblHealth.Font.Color := $00924516;
end;

procedure TMainForm.RefreshPrinters;
var
  I: Integer;
begin
  CbPrinters.Items.BeginUpdate;
  try
    CbPrinters.Items.Clear;
    for I := 0 to Printer.Printers.Count - 1 do
      CbPrinters.Items.Add(Printer.Printers[I]);
  finally
    CbPrinters.Items.EndUpdate;
  end;
end;

procedure TMainForm.RebuildStationPanel;
var
  I, TopPos, PrinterIndex: Integer;
  Chk: TCheckBox;
  Combo: TComboBox;
begin
  while StationPanel.ControlCount > 0 do
    StationPanel.Controls[0].Free;
  with TLabel.Create(Self) do
  begin
    Parent := StationPanel;
    Caption := IfThen(FUseStationRouting,
      'Roteamento por estacao',
      'Roteamento por estacao desativado. Tudo usa a impressora principal.');
    Font.Style := [fsBold];
    Left := 16;
    Top := 10;
    Width := 620;
  end;
  TopPos := 36;
  for I := 0 to High(FStations) do
  begin
    Chk := TCheckBox.Create(Self);
    Chk.Parent := StationPanel;
    Chk.Caption := FStations[I].Name;
    Chk.Left := 16;
    Chk.Top := TopPos;
    Chk.Width := 190;
    Chk.Checked := IsAssignedStation(FStations[I].Id);
    Chk.Enabled := FUseStationRouting;
    Chk.Tag := I;
    Chk.OnClick := StationAssignedClick;

    Combo := TComboBox.Create(Self);
    Combo.Parent := StationPanel;
    Combo.Left := 226;
    Combo.Top := TopPos - 2;
    Combo.Width := 410;
    Combo.Style := csDropDownList;
    Combo.Enabled := FUseStationRouting;
    Combo.Items.Assign(CbPrinters.Items);
    Combo.Items.Insert(0, 'Usar impressora padrao');
    Combo.ItemIndex := 0;
    Combo.Tag := I;
    for PrinterIndex := 1 to Combo.Items.Count - 1 do
      if SameText(Combo.Items[PrinterIndex], GetStationPrinter(FStations[I].Id)) then
      begin
        Combo.ItemIndex := PrinterIndex;
        Break;
      end;
    Combo.OnChange := StationPrinterChange;
    Inc(TopPos, 30);
  end;
  StationPanel.Height := TopPos + 12;
end;

procedure TMainForm.RegisterMachine;
var
  Body, ResponseText: string;
  Obj: TJSONObject;
  Value: TJSONValue;
  Arr: TJSONArray;
  I: Integer;
begin
  if FMerchantId = '' then
    Exit;
  try
    Body := TJSONObject.Create
      .AddPair('merchantId', FMerchantId)
      .AddPair('machineId', FMachineId)
      .AddPair('stationIds', AssignedStationsJson)
      .ToString;
    ApiRequest('/api/print/register', 'POST', Body, '', ResponseText);
    Value := TJSONObject.ParseJSONValue(ResponseText);
    try
      Obj := Value as TJSONObject;
      if Obj <> nil then
      begin
        FStoreName := JsonString(Obj, 'storeName', FStoreName);
        FPrintToken := JsonString(Obj, 'printToken', FPrintToken);
        Arr := Obj.GetValue('printerStations') as TJSONArray;
        if Arr <> nil then
        begin
          SetLength(FStations, Arr.Count);
          for I := 0 to Arr.Count - 1 do
          begin
            FStations[I].Id := NormalizeStationId(JsonString(Arr.Items[I] as TJSONObject, 'id', ''));
            FStations[I].Name := JsonString(Arr.Items[I] as TJSONObject, 'name', FStations[I].Id);
          end;
        end;
        EnsureDefaults;
        SaveConfig;
        SetStatus('Idle', 'HEALTHY', '', True);
        Log('INFO', 'registered machine');
      end;
    finally
      Value.Free;
    end;
  except
    on E: Exception do
    begin
      Log('ERROR', 'registration error: ' + E.Message);
      SetStatus('Error', 'ERROR', E.Message, False);
    end;
  end;
end;

procedure TMainForm.ApiRequest(const Endpoint, Method, Body, Token: string; out ResponseText: string);
var
  Client: THTTPClient;
  Stream: TStringStream;
  Response: IHTTPResponse;
  Headers: TNetHeaders;
  Url: string;
begin
  Url := FApiUrl.TrimRight(['/']) + Endpoint;
  Client := THTTPClient.Create;
  try
    Client.ConnectionTimeout := REQUEST_TIMEOUT_MS;
    Client.ResponseTimeout := REQUEST_TIMEOUT_MS;
    SetLength(Headers, 1);
    Headers[0].Name := 'Content-Type';
    Headers[0].Value := 'application/json';
    if Token <> '' then
    begin
      SetLength(Headers, 2);
      Headers[1].Name := 'Authorization';
      Headers[1].Value := 'Bearer ' + Token;
    end;
    if SameText(Method, 'POST') then
    begin
      Stream := TStringStream.Create(Body, TEncoding.UTF8);
      try
        Response := Client.Post(Url, Stream, nil, Headers);
      finally
        Stream.Free;
      end;
    end
    else
      Response := Client.Get(Url, nil, Headers);
    ResponseText := Response.ContentAsString(TEncoding.UTF8);
    if (Response.StatusCode < 200) or (Response.StatusCode >= 300) then
      raise Exception.CreateFmt('API %d: %s', [Response.StatusCode, ResponseText]);
  finally
    Client.Free;
  end;
end;

procedure TMainForm.StartPolling;
begin
  PollTimer.Enabled := True;
end;

procedure TMainForm.StopPolling;
begin
  PollTimer.Enabled := False;
end;

procedure TMainForm.PollTimerTick(Sender: TObject);
begin
  if FPolling or (FMerchantId = '') or (FPrintToken = '') then
    Exit;
  FPolling := True;
  TThread.CreateAnonymousThread(
    procedure
    begin
      try
        PollJobs;
      finally
        FPolling := False;
      end;
    end).Start;
end;

procedure TMainForm.PollJobs;
var
  Endpoint, ResponseText: string;
  I: Integer;
  Value: TJSONValue;
  Arr: TJSONArray;
  Obj: TJSONObject;
  Jobs: TArray<TPrintJob>;
begin
  try
    Endpoint := '/api/print/jobs?merchantId=' + TNetEncoding.URL.Encode(FMerchantId);
    if FUseStationRouting and (FAssignedStations.Count > 0) then
      Endpoint := Endpoint + '&stationIds=' + TNetEncoding.URL.Encode(StringReplace(FAssignedStations.CommaText, '"', '', [rfReplaceAll]));
    ApiRequest(Endpoint, 'GET', '', FPrintToken, ResponseText);
    Value := TJSONObject.ParseJSONValue(ResponseText);
    try
      Arr := Value as TJSONArray;
      if Arr = nil then
        Exit;
      SetLength(Jobs, Arr.Count);
      for I := 0 to Arr.Count - 1 do
      begin
        Obj := Arr.Items[I] as TJSONObject;
        Jobs[I].Id := JsonString(Obj, 'id', '');
        Jobs[I].PrintText := JsonString(Obj, 'printText', JsonString(Obj, 'text', ''));
        Jobs[I].StationId := NormalizeStationId(JsonString(Obj, 'stationId', ''));
      end;
    finally
      Value.Free;
    end;
    SetStatus('Idle', 'HEALTHY', '', True);
    if Length(Jobs) > 0 then
      ProcessJobs(Jobs);
  except
    on E: Exception do
    begin
      Log('ERROR', 'polling error: ' + E.Message);
      SetStatus('Error', 'DEGRADED', E.Message, False);
      if (Pos('401', E.Message) > 0) or (Pos('403', E.Message) > 0) then
        RegisterMachine;
    end;
  end;
end;

procedure TMainForm.ProcessJobs(const Jobs: TArray<TPrintJob>);
var
  Job: TPrintJob;
begin
  if FProcessing then
    Exit;
  FProcessing := True;
  try
    for Job in Jobs do
    begin
      if Job.Id = '' then
        Continue;
      TrimProcessedJobs;
      if FProcessedJobs.ContainsKey(Job.Id) then
        Continue;
      try
        SetStatus('Printing', 'HEALTHY', '', True);
        PrintJob(Job);
        MarkPrinted(Job.Id);
        FProcessedJobs.AddOrSetValue(Job.Id, Now);
        SaveProcessedJobs;
        FLastPrintedAt := FormatDateTime('dd/mm/yyyy hh:nn:ss', Now);
        FLastPrintedId := Job.Id;
        SetStatus('Idle', 'HEALTHY', '', True);
      except
        on E: Exception do
        begin
          Log('ERROR', 'print error ' + Job.Id + ': ' + E.Message);
          SetStatus('Error', 'ERROR', E.Message, True);
          MarkFailed(Job.Id, E.Message, True);
        end;
      end;
    end;
  finally
    FProcessing := False;
  end;
end;

procedure TMainForm.PrintJob(const Job: TPrintJob);
var
  PrinterName: string;
  Data: TBytes;
begin
  PrinterName := ResolveJobPrinter(Job);
  if PrinterName = '' then
    raise Exception.Create('Impressora nao configurada');
  Data := BuildEscPosPayload(Job.PrintText);
  RawPrint(PrinterName, Data);
  Log('INFO', 'printed job ' + Job.Id + ' on ' + PrinterName);
end;

procedure TMainForm.MarkPrinted(const JobId: string);
var
  ResponseText: string;
begin
  ApiRequest('/api/print/jobs/' + JobId + '/printed', 'POST', '{}', FPrintToken, ResponseText);
end;

procedure TMainForm.MarkFailed(const JobId, Reason: string; Retry: Boolean);
var
  Obj: TJSONObject;
  ResponseText: string;
begin
  Obj := TJSONObject.Create;
  try
    Obj.AddPair('reason', Reason);
    Obj.AddPair('retry', TJSONBool.Create(Retry));
    ApiRequest('/api/print/jobs/' + JobId + '/failed', 'POST', Obj.ToString, FPrintToken, ResponseText);
  finally
    Obj.Free;
  end;
end;

function TMainForm.ResolveJobPrinter(const Job: TPrintJob): string;
begin
  Result := '';
  if FUseStationRouting and (Job.StationId <> '') then
    Result := GetStationPrinter(Job.StationId);
  if Result = '' then
    Result := FPrinterName;
end;

function TMainForm.EncodePrintText(const Text: string): TBytes;
var
  Enc: TEncoding;
begin
  try
    Enc := TEncoding.GetEncoding(860);
    try
      Result := Enc.GetBytes(Text);
    finally
      Enc.Free;
    end;
  except
    Result := TEncoding.ANSI.GetBytes(Text);
  end;
end;

function TMainForm.BuildEscPosPayload(const Text: string): TBytes;
var
  CleanText, WithFeed: string;
  Encoded: TBytes;
  Prefix: array[0..2] of Byte;
  Cut: array[0..2] of Byte;
  I, Offset: Integer;
begin
  CleanText := StringReplace(Text, #13#10, #10, [rfReplaceAll]);
  WithFeed := CleanText + StringOfChar(#10, 5);
  Encoded := EncodePrintText(WithFeed);
  Prefix[0] := $1B;
  Prefix[1] := $74;
  Prefix[2] := $03;
  Cut[0] := $1D;
  Cut[1] := $56;
  Cut[2] := $00;
  SetLength(Result, Length(Prefix) + Length(Encoded) + Length(Cut));
  Offset := 0;
  for I := 0 to High(Prefix) do
  begin
    Result[Offset] := Prefix[I];
    Inc(Offset);
  end;
  for I := 0 to High(Encoded) do
  begin
    Result[Offset] := Encoded[I];
    Inc(Offset);
  end;
  for I := 0 to High(Cut) do
  begin
    Result[Offset] := Cut[I];
    Inc(Offset);
  end;
end;

procedure TMainForm.RawPrint(const PrinterName: string; const Data: TBytes);
var
  Handle: THandle;
  DocInfo: TDocInfo1;
  Written: DWORD;
begin
  if not OpenPrinter(PChar(PrinterName), Handle, nil) then
    raise Exception.CreateFmt('Nao foi possivel abrir impressora: %s', [PrinterName]);
  try
    FillChar(DocInfo, SizeOf(DocInfo), 0);
    DocInfo.pDocName := 'Menufaz Print';
    DocInfo.pDatatype := 'RAW';
    if StartDocPrinter(Handle, 1, @DocInfo) = 0 then
      RaiseLastOSError;
    try
      if not StartPagePrinter(Handle) then
        RaiseLastOSError;
      try
        if (Length(Data) > 0) and (not WritePrinter(Handle, @Data[0], Length(Data), Written)) then
          RaiseLastOSError;
      finally
        EndPagePrinter(Handle);
      end;
    finally
      EndDocPrinter(Handle);
    end;
  finally
    ClosePrinter(Handle);
  end;
end;

function TMainForm.NormalizeStationId(const Value: string): string;
var
  S: string;
  I: Integer;
  C: Char;
begin
  S := LowerCase(Trim(Value));
  S := StringReplace(S, 'ç', 'c', [rfReplaceAll]);
  S := StringReplace(S, 'ã', 'a', [rfReplaceAll]);
  S := StringReplace(S, 'á', 'a', [rfReplaceAll]);
  S := StringReplace(S, 'à', 'a', [rfReplaceAll]);
  S := StringReplace(S, 'â', 'a', [rfReplaceAll]);
  S := StringReplace(S, 'é', 'e', [rfReplaceAll]);
  S := StringReplace(S, 'ê', 'e', [rfReplaceAll]);
  S := StringReplace(S, 'í', 'i', [rfReplaceAll]);
  S := StringReplace(S, 'ó', 'o', [rfReplaceAll]);
  S := StringReplace(S, 'ô', 'o', [rfReplaceAll]);
  S := StringReplace(S, 'õ', 'o', [rfReplaceAll]);
  S := StringReplace(S, 'ú', 'u', [rfReplaceAll]);
  Result := '';
  for I := 1 to Length(S) do
  begin
    C := S[I];
    if CharInSet(C, ['a'..'z', '0'..'9']) then
      Result := Result + C
    else if (Result <> '') and (Result[Length(Result)] <> '-') then
      Result := Result + '-';
  end;
  while (Result <> '') and (Result[Length(Result)] = '-') do
    Delete(Result, Length(Result), 1);
end;

function TMainForm.StationExists(const StationId: string): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 0 to High(FStations) do
    if SameText(FStations[I].Id, StationId) then
      Exit(True);
end;

function TMainForm.GetStationPrinter(const StationId: string): string;
begin
  if not FStationPrinters.TryGetValue(NormalizeStationId(StationId), Result) then
    Result := '';
end;

procedure TMainForm.SetStationPrinter(const StationId, PrinterName: string);
var
  Key: string;
begin
  Key := NormalizeStationId(StationId);
  if PrinterName = '' then
    FStationPrinters.Remove(Key)
  else
    FStationPrinters.AddOrSetValue(Key, PrinterName);
end;

function TMainForm.IsAssignedStation(const StationId: string): Boolean;
begin
  Result := FAssignedStations.IndexOf(NormalizeStationId(StationId)) >= 0;
end;

procedure TMainForm.SetAssignedStation(const StationId: string; Assigned: Boolean);
var
  Key: string;
  Index: Integer;
begin
  Key := NormalizeStationId(StationId);
  Index := FAssignedStations.IndexOf(Key);
  if Assigned and (Index < 0) then
    FAssignedStations.Add(Key)
  else if (not Assigned) and (Index >= 0) then
    FAssignedStations.Delete(Index);
  if FAssignedStations.Count = 0 then
    FAssignedStations.Add(Key);
end;

function TMainForm.AutoStartEnabled: Boolean;
var
  Reg: TRegistry;
begin
  Result := False;
  Reg := TRegistry.Create(KEY_READ);
  try
    Reg.RootKey := HKEY_CURRENT_USER;
    if Reg.OpenKeyReadOnly('Software\Microsoft\Windows\CurrentVersion\Run') then
      Result := Reg.ValueExists('Menufaz Print') or Reg.ValueExists('MenufazPrint');
  finally
    Reg.Free;
  end;
end;

procedure TMainForm.SetAutoStartEnabled(Enabled: Boolean);
var
  Reg: TRegistry;
begin
  Reg := TRegistry.Create(KEY_WRITE);
  try
    Reg.RootKey := HKEY_CURRENT_USER;
    if Reg.OpenKey('Software\Microsoft\Windows\CurrentVersion\Run', True) then
    begin
      if Enabled then
      begin
        Reg.WriteString('Menufaz Print', '"' + Application.ExeName + '"');
        if Reg.ValueExists('MenufazPrint') then
          Reg.DeleteValue('MenufazPrint');
      end
      else if Reg.ValueExists('MenufazPrint') then
        Reg.DeleteValue('MenufazPrint');
      if (not Enabled) and Reg.ValueExists('Menufaz Print') then
        Reg.DeleteValue('Menufaz Print');
    end;
  finally
    Reg.Free;
  end;
end;

procedure TMainForm.ApplyAutoStart;
begin
  SetAutoStartEnabled(FAutoLaunch);
end;

procedure TMainForm.SaveClick(Sender: TObject);
begin
  FMerchantId := Trim(EdMerchant.Text);
  FApiUrl := Trim(EdApi.Text);
  if FApiUrl = '' then
    FApiUrl := DEFAULT_API_URL;
  SaveConfig;
  RegisterMachine;
  UpdateUi;
end;

procedure TMainForm.ResetClick(Sender: TObject);
begin
  FMerchantId := '';
  FStoreName := '';
  FPrintToken := '';
  FPrinterName := '';
  FApiUrl := DEFAULT_API_URL;
  FUseStationRouting := False;
  FAssignedStations.Clear;
  FStationPrinters.Clear;
  EnsureDefaults;
  SaveConfig;
  UpdateUi;
end;

procedure TMainForm.RefreshPrintersClick(Sender: TObject);
begin
  RefreshPrinters;
  UpdateUi;
end;

procedure TMainForm.TestPrintClick(Sender: TObject);
var
  Job: TPrintJob;
  I: Integer;
begin
  Job.Id := 'test-' + FormatDateTime('yyyymmddhhnnss', Now);
  Job.StationId := 'caixa';
  Job.PrintText := '*** TESTE DE IMPRESSAO MENUFAZ ***' + #10 +
    IfThen(FStoreName <> '', FStoreName, 'Menufaz') + #10 +
    FMerchantId + #10 +
    FormatDateTime('dd/mm/yyyy hh:nn:ss', Now) + #10#10 +
    'Feijao' + #10 +
    'Acucar' + #10 +
    'Informacao' + #10 +
    'Pao de queijo' + #10 +
    'Coracao' + #10;
  for I := 1 to 25 do
    Job.PrintText := Job.PrintText + Format('Item %d - Observacao longa para teste de corte e linhas', [I]) + #10;
  PrintJob(Job);
  FLastPrintedAt := FormatDateTime('dd/mm/yyyy hh:nn:ss', Now);
  FLastPrintedId := Job.Id;
  UpdateUi;
end;

procedure TMainForm.AutoStartClick(Sender: TObject);
begin
  FAutoLaunch := CbAutoStart.Checked;
  ApplyAutoStart;
  SaveConfig;
end;

procedure TMainForm.ModeClick(Sender: TObject);
begin
  FUseStationRouting := RbStationRouting.Checked;
  SaveConfig;
  RegisterMachine;
  UpdateUi;
end;

procedure TMainForm.PrinterChange(Sender: TObject);
begin
  if CbPrinters.ItemIndex >= 0 then
    FPrinterName := CbPrinters.Text
  else
    FPrinterName := '';
  SaveConfig;
end;

procedure TMainForm.StationAssignedClick(Sender: TObject);
var
  Chk: TCheckBox;
begin
  Chk := Sender as TCheckBox;
  if (Chk.Tag >= 0) and (Chk.Tag <= High(FStations)) then
  begin
    SetAssignedStation(FStations[Chk.Tag].Id, Chk.Checked);
    SaveConfig;
    RegisterMachine;
  end;
end;

procedure TMainForm.StationPrinterChange(Sender: TObject);
var
  Combo: TComboBox;
begin
  Combo := Sender as TComboBox;
  if (Combo.Tag >= 0) and (Combo.Tag <= High(FStations)) then
  begin
    if Combo.ItemIndex <= 0 then
      SetStationPrinter(FStations[Combo.Tag].Id, '')
    else
      SetStationPrinter(FStations[Combo.Tag].Id, Combo.Text);
    SaveConfig;
  end;
end;

procedure TMainForm.TrayOpenClick(Sender: TObject);
begin
  Show;
  WindowState := wsNormal;
  Application.Restore;
end;

procedure TMainForm.TrayExitClick(Sender: TObject);
begin
  FClosingToTray := False;
  TrayIcon.Visible := False;
  Close;
end;

procedure TMainForm.FormCloseQuery(Sender: TObject; var CanClose: Boolean);
begin
  if not FClosingToTray and TrayIcon.Visible then
  begin
    CanClose := False;
    Hide;
    Exit;
  end;
  CanClose := True;
end;

procedure TMainForm.FormDestroy(Sender: TObject);
begin
  StopPolling;
  SaveConfig;
  SaveProcessedJobs;
  FAssignedStations.Free;
  FStationPrinters.Free;
  FProcessedJobs.Free;
  if FMutex <> 0 then
    CloseHandle(FMutex);
end;

end.
