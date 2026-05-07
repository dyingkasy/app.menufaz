program MenufazPrint;

uses
  Vcl.Forms,
  MainForm in 'MainForm.pas';

{$R *.res}

begin
  Application.Initialize;
  Application.MainFormOnTaskbar := True;
  Application.Title := 'Menufaz Print';
  Application.CreateForm(TMainForm, FrmMain);
  Application.Run;
end.
