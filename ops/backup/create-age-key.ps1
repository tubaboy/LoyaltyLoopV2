$ErrorActionPreference = 'Stop'

function Protect-IdentityFile([string]$Path, [bool]$Directory = $false) {
  $acl = Get-Acl -LiteralPath $Path
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleAll($rule) }

  $principals = @(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
    (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')),
    (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544'))
  )
  foreach ($principal in $principals) {
    if ($Directory) {
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $principal,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
      )
    } else {
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $principal,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
      )
    }
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl

  $verified = Get-Acl -LiteralPath $Path
  if (-not $verified.AreAccessRulesProtected) { throw "無法確認私鑰 ACL 已停用繼承：$Path" }
  $allowedSids = @($principals | ForEach-Object { $_.Value })
  foreach ($rule in $verified.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $rule.IdentityReference.Value -notin $allowedSids) {
      throw "私鑰仍有非預期的 ACL 權限；已保留檔案，請勿傳送：$Path"
    }
  }
}

function Invoke-AgeKeygen([string]$Executable, [string]$Arguments, [string]$StdoutPath, [string]$StderrPath) {
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath
  return $process.ExitCode
}

function Get-PublicKeyFromIdentity([string]$Executable, [string]$IdentityPath) {
  $publicPath = Join-Path $env:TEMP ("llv2-public-" + [guid]::NewGuid().ToString('N') + '.txt')
  $stdoutPath = Join-Path $env:TEMP ("llv2-stdout-" + [guid]::NewGuid().ToString('N') + '.txt')
  $stderrPath = Join-Path $env:TEMP ("llv2-stderr-" + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    $arguments = '-y -o "' + $publicPath + '" "' + $IdentityPath + '"'
    $exitCode = Invoke-AgeKeygen $Executable $arguments $stdoutPath $stderrPath
    if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $publicPath)) {
      throw 'age-keygen 無法取得公鑰。既有私鑰已保留，請勿刪除或傳送。'
    }
    $match = [regex]::Match([IO.File]::ReadAllText($publicPath), '(?im)^\s*(age1[0-9a-z]+)\s*$')
    if (-not $match.Success) { throw '無法解析公鑰；既有私鑰已保留。' }
    return $match.Groups[1].Value
  } finally {
    Remove-Item -LiteralPath $publicPath, $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Show-ErrorDialog([string]$Message) {
  [void][System.Windows.Forms.MessageBox]::Show(
    $Message,
    'LoyaltyLoopV2 備份金鑰工具',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  )
}

function Show-PublicKeyDialog([string]$PublicKey, [string]$IdentityPath, [bool]$Existing) {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'LoyaltyLoopV2 備份金鑰'
  $form.StartPosition = 'CenterScreen'
  $form.Size = New-Object System.Drawing.Size(610, 250)
  $form.MinimumSize = $form.Size
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.FormBorderStyle = 'FixedDialog'

  $notice = New-Object System.Windows.Forms.Label
  $notice.Location = New-Object System.Drawing.Point(18, 16)
  $notice.Size = New-Object System.Drawing.Size(560, 42)
  $notice.Text = if ($Existing) { '找到既有私鑰。請保留它；以下只顯示對應公鑰。' } else { '私鑰已建立並保存在離線資料夾。請勿傳送私鑰檔。' }
  $form.Controls.Add($notice)

  $pathLabel = New-Object System.Windows.Forms.Label
  $pathLabel.Location = New-Object System.Drawing.Point(18, 62)
  $pathLabel.Size = New-Object System.Drawing.Size(560, 38)
  $pathLabel.Text = "私鑰檔案：$IdentityPath"
  $form.Controls.Add($pathLabel)

  $keyBox = New-Object System.Windows.Forms.TextBox
  $keyBox.Location = New-Object System.Drawing.Point(18, 108)
  $keyBox.Size = New-Object System.Drawing.Size(555, 28)
  $keyBox.ReadOnly = $true
  $keyBox.Text = $PublicKey
  $keyBox.Font = New-Object System.Drawing.Font('Consolas', 10)
  $form.Controls.Add($keyBox)

  $status = New-Object System.Windows.Forms.Label
  $status.Location = New-Object System.Drawing.Point(182, 162)
  $status.Size = New-Object System.Drawing.Size(390, 30)
  $status.Text = '請只提供上方 age1... 公鑰。'
  $form.Controls.Add($status)

  $copyButton = New-Object System.Windows.Forms.Button
  $copyButton.Location = New-Object System.Drawing.Point(18, 154)
  $copyButton.Size = New-Object System.Drawing.Size(150, 34)
  $copyButton.Text = '複製公鑰'
  $copyClick = {
    [System.Windows.Forms.Clipboard]::SetText($PublicKey)
    $status.Text = '公鑰已複製。回到對話貼上即可；不要傳送私鑰檔。'
  }.GetNewClosure()
  $copyButton.Add_Click($copyClick)
  $form.Controls.Add($copyButton)

  [void]$form.ShowDialog()
  $form.Dispose()
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $picker = New-Object System.Windows.Forms.FolderBrowserDialog
  $picker.Description = '請選擇已加密的 USB 或其他離線資料夾。請勿選專案目錄、OneDrive 或 Google Drive。'
  $picker.ShowNewFolderButton = $true
  $picker.RootFolder = [System.Environment+SpecialFolder]::MyComputer
  if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }

  $keyFolder = [IO.Path]::GetFullPath($picker.SelectedPath)
  $legacyIdentityPath = Join-Path $keyFolder 'loyaltyloop-v2-age-identity.txt'
  $secureFolder = Join-Path $keyFolder 'LoyaltyLoopV2-Backup-Key'
  $secureIdentityPath = Join-Path $secureFolder 'loyaltyloop-v2-age-identity.txt'

  $ageKeygen = Get-Command age-keygen -ErrorAction SilentlyContinue
  if (-not $ageKeygen) {
    throw '找不到 age-keygen。請安裝 age（官方 Windows 套件 ID：FiloSottile.age），再重新開啟工具。'
  }

  $identityPath = $null
  if (Test-Path -LiteralPath $legacyIdentityPath) {
    $identityPath = $legacyIdentityPath
  } elseif (Test-Path -LiteralPath $secureIdentityPath) {
    $identityPath = $secureIdentityPath
  }

  if ($identityPath) {
    Protect-IdentityFile $identityPath
    $existingPublic = Get-PublicKeyFromIdentity $ageKeygen.Source $identityPath
    Show-PublicKeyDialog $existingPublic $identityPath $true
    exit 0
  }

  if (Test-Path -LiteralPath $secureFolder) {
    if (@(Get-ChildItem -LiteralPath $secureFolder -Force).Count -gt 0) {
      throw "資料夾已存在且不是空的，為避免改動其他檔案，請選另一個離線資料夾：$secureFolder"
    }
  } else {
    New-Item -ItemType Directory -Path $secureFolder | Out-Null
  }
  Protect-IdentityFile $secureFolder $true

  $identityPath = $secureIdentityPath
  $stdoutPath = Join-Path $env:TEMP ("llv2-age-stdout-" + [guid]::NewGuid().ToString('N') + '.txt')
  $stderrPath = Join-Path $env:TEMP ("llv2-age-stderr-" + [guid]::NewGuid().ToString('N') + '.txt')
  try {
    $arguments = '-o "' + $identityPath + '"'
    $keygenExitCode = Invoke-AgeKeygen $ageKeygen.Source $arguments $stdoutPath $stderrPath
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
  if ($keygenExitCode -ne 0 -or -not (Test-Path -LiteralPath $identityPath)) {
    throw "age-keygen 未能完成。若已建立檔案，請先保留，不要傳送：$identityPath"
  }

  Protect-IdentityFile $identityPath
  $publicKey = Get-PublicKeyFromIdentity $ageKeygen.Source $identityPath
  Show-PublicKeyDialog $publicKey $identityPath $false
}
catch {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [void][System.Windows.Forms.MessageBox]::Show(
      $_.Exception.Message,
      'LoyaltyLoopV2 備份金鑰工具',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    )
  } catch {
    Write-Error $_
  }
  exit 1
}
