<div align="center">
  <img height="170" src="https://293354890-files.gitbook.io/~/files/v0/b/gitbook-legacy-files/o/assets%2F-M_72skN1dye71puMdjs%2F-Miqzl5oK1cXXAkARfER%2F-Mis-yeKp1Krh7JOFzQG%2Fjet_logomark_color.png?alt=media&token=0b8dfc84-37d7-455d-9dfd-7bb59cee5a1a" />

  <h1>Jet V2</h1>

  <p>
    <a target="_blank" href="https://github.com/jet-lab/jet-v2/actions/workflows/rust_coverage.yml">
      <img alt="Build" src="https://github.com/jet-lab/jet-v2/actions/workflows/rust_coverage.yml/badge.svg" />
    </a>
    <a target="_blank" href="https://discord.com/channels/880316176612343891">
      <img alt="Discord" src="https://img.shields.io/discord/833805114602291200?color=blueviolet" />
    </a>
    <a target="_blank" href="https://opensource.org/licenses/AGPL-3.0">
      <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue" />
    </a>
  </p>

  <h4>
    <a target="_blank" href="https://jetprotocol.io">Webite</a>
    |
    <a target="_blank" href="https://docs.jetprotocol.io">Docs</a>
  </h4>
</div>

# Installation

To install Anchor please see the [Anchor Documentation](https://project-serum.github.io/anchor/getting-started/installation.html)

Make sure you update Solana to the latest version

```
# Update Solana
solana-install update

# Or install Solana from scratch
sh -c "$(curl -sSfL https://release.solana.com/latest/install)"
```

Install anchor v0.21.0

```
# Install dependencies if running Ubuntu
sudo apt-get update && sudo apt-get upgrade && sudo apt-get install -y pkg-config build-essential libudev-dev

cargo install --git https://github.com/project-serum/anchor avm --locked --force

avm install 0.21.0
avm use 0.21.0
anchor --version # anchor-cli 0.21.0
```

Install the project's node_modules

```
npm i
```

Then run

```
anchor test
```
