# Development install (Windows): builds the plugin and links this folder into the Stream Deck plugins folder,
# so rebuilding is enough to update it. Restart the Stream Deck software afterwards.
# For normal use, install the .streamDeckPlugin file from the releases page instead.
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$plugin = Join-Path $root "com.foxy.magicqdeck.sdPlugin"
$target = Join-Path $env:APPDATA "Elgato\StreamDeck\Plugins\com.foxy.magicqdeck.sdPlugin"

Push-Location $root
npm install
npm run build
Pop-Location

New-Item -ItemType Directory -Force (Join-Path $plugin "logs") | Out-Null   # the plugin logs here

if (Test-Path $target) {
    $item = Get-Item $target -Force
    if ($item.LinkType -ne "Junction") {
        Write-Error "$target already exists and is not a link (an installed copy?). Remove it first."
    }
    Write-Host "Already linked: $target"
} else {
    New-Item -ItemType Junction -Path $target -Target $plugin | Out-Null
    Write-Host "Linked $target -> $plugin"
}
Write-Host "Done. Restart the Stream Deck software to load the plugin."
