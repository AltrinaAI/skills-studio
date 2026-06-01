<#
.SYNOPSIS
    Signs a Windows binary with Azure Artifact Signing (formerly Trusted Signing) via jsign.

.DESCRIPTION
    Invoked by Tauri's `bundle.windows.signCommand`. Tauri passes the path of each
    binary/installer to sign as the first argument (the "%1" placeholder).

    Signing is skipped gracefully (exit 0) when the signing configuration is absent,
    so builds keep working before the Azure certificate profile / identity validation
    is ready. Once AZURE_SIGNING_ALIAS is provided, signing activates automatically.

.REQUIRED ENVIRONMENT
    AZURE_SIGNING_ENDPOINT  e.g. https://wus2.codesigning.azure.net
    AZURE_SIGNING_ALIAS     "<account-name>/<certificate-profile-name>"
    (an authenticated `az` session is required to mint the signing token)

.OPTIONAL ENVIRONMENT
    JSIGN_JAR               path to jsign.jar; if unset, the `jsign` launcher on PATH is used
    AZURE_TIMESTAMP_URL     timestamp authority (defaults to Microsoft's RFC3161 TSA)
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath
)

$ErrorActionPreference = "Stop"

$endpoint = $env:AZURE_SIGNING_ENDPOINT
$alias    = $env:AZURE_SIGNING_ALIAS

if ([string]::IsNullOrWhiteSpace($endpoint) -or [string]::IsNullOrWhiteSpace($alias)) {
    Write-Warning "Azure signing not configured (AZURE_SIGNING_ENDPOINT / AZURE_SIGNING_ALIAS missing). Skipping signing of '$FilePath'."
    exit 0
}

$tsaUrl = if ([string]::IsNullOrWhiteSpace($env:AZURE_TIMESTAMP_URL)) {
    "http://timestamp.acs.microsoft.com/"
} else {
    $env:AZURE_TIMESTAMP_URL
}

# Mint a short-lived access token for the code signing service from the current az session.
$token = az account get-access-token --resource "https://codesigning.azure.net" --query accessToken -o tsv
if ([string]::IsNullOrWhiteSpace($token)) {
    throw "Failed to obtain an Azure access token for code signing (is 'az login' done?)."
}

# Prefer an explicit jar (CI downloads one); otherwise rely on the jsign launcher on PATH.
if (-not [string]::IsNullOrWhiteSpace($env:JSIGN_JAR)) {
    $exe = "java"
    $pre = @("-jar", $env:JSIGN_JAR)
} else {
    $exe = "jsign"
    $pre = @()
}

$jsignArgs = @(
    "--storetype", "TRUSTEDSIGNING",
    "--keystore",  $endpoint,
    "--storepass", $token,
    "--alias",     $alias,
    "--tsaurl",    $tsaUrl,
    "--tsmode",    "RFC3161",
    $FilePath
)

Write-Host "Signing '$FilePath' with Azure Artifact Signing (alias: $alias)"
& $exe @($pre + $jsignArgs)
if ($LASTEXITCODE -ne 0) {
    throw "jsign failed with exit code $LASTEXITCODE while signing '$FilePath'."
}
Write-Host "Signed '$FilePath'"
