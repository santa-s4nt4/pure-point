# Runs in its own PowerShell process. Authentication, including MFA and consent,
# is handled by the official Microsoft.Graph.Authentication module.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$graph = 'https://graph.microsoft.com/v1.0'
try {
    Import-Module Microsoft.Graph.Authentication
    Connect-MgGraph -TenantId $env:PURE_POINT_SHARE_TENANT -Scopes 'Files.ReadWrite' -ContextScope Process -Environment Global -NoWelcome | Out-Null
    $account = Get-MgContext
    if ($account.TenantId -ne $env:PURE_POINT_SHARE_TENANT -or $account.AuthType -ne 'Delegated' -or
        $account.Environment -ne 'Global' -or $account.Scopes -notcontains 'Files.ReadWrite') { exit 20 }
} catch { exit 20 }

try {
    $root = Invoke-MgGraphRequest -Method GET -Uri "$graph/me/drive/root?`$select=id,folder,parentReference,sharepointIds" -OutputType PSObject
    if (!$root.id -or $null -eq $root.folder -or !$root.sharepointIds.listId -or
        $root.sharepointIds.tenantId -ne $env:PURE_POINT_SHARE_TENANT -or !$root.sharepointIds.siteUrl -or
        $root.sharepointIds.siteUrl.TrimEnd('/') -ne $env:PURE_POINT_SHARE_SITE) { exit 21 }
    $path = (($env:PURE_POINT_SHARE_PATH -split '/') | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
    $item = Invoke-MgGraphRequest -Method GET -Uri "$graph/me/drive/root:/${path}?`$select=id,sharepointIds,parentReference,file,size,remoteItem" -OutputType PSObject
    $sp = $item.sharepointIds
    if ($null -ne $item.remoteItem -or !$item.id -or !$item.parentReference.driveId -or !$item.file -or
        $sp.tenantId -ne $env:PURE_POINT_SHARE_TENANT -or $sp.listId -ne $root.sharepointIds.listId -or
        ($root.parentReference.driveId -and $root.parentReference.driveId -ne $item.parentReference.driveId) -or
        !$sp.siteUrl -or $sp.siteUrl.TrimEnd('/') -ne $env:PURE_POINT_SHARE_SITE) { exit 21 }
    if ($null -eq $item.size -or [long]$item.size -ne [long]$env:PURE_POINT_SHARE_SIZE -or
        $item.file.hashes.quickXorHash -cne $env:PURE_POINT_SHARE_HASH) { exit 22 }
} catch { exit 21 }

try {
    $drive = [uri]::EscapeDataString($item.parentReference.driveId)
    $id = [uri]::EscapeDataString($item.id)
    $permission = Invoke-MgGraphRequest -Method POST -Uri "$graph/drives/$drive/items/$id/createLink" -Body '{"scope":"organization","type":"edit"}' -ContentType 'application/json' -OutputType PSObject
    $link = $permission.link
    if ($link.scope -cne 'organization' -or $link.type -cne 'edit' -or $permission.roles -notcontains 'write') { exit 23 }
    $url = [uri]::new($link.webUrl, [UriKind]::Absolute)
    if ($url.Scheme -ne 'https' -or !$url.IsDefaultPort -or $url.UserInfo -or
        $url.Host -ne ([uri]$env:PURE_POINT_SHARE_SITE).Host) { exit 23 }
    [Console]::Out.Write($url.AbsoluteUri)
} catch { exit 23 }
