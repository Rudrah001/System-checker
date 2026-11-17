from native_checker import system_checks
def test_errors_produce_unknown(monkeypatch):
    monkeypatch.setattr(system_checks, '_ps', lambda _: (_ for _ in ()).throw(RuntimeError('missing PowerShell')))
    result=system_checks.collect(); assert result['status']=='UNKNOWN'; assert result['check_errors']
