# Liquidity Vault — РК1 Build Sprint

Anchor-каркас vault-программы на Solana. В этом стартовом этапе реализованы настройки vault, пользовательская позиция PDA, share-token mint и ATA для базового актива.

## Инструменты

- Rust stable
- Anchor CLI 0.31.1
- Solana CLI 2.1.0 — рекомендованная версия для Anchor 0.31.1
- Node.js 18+ и Yarn для клиентской части курса
- Git

Проверить версии:

```sh
rustc --version
solana --version
anchor --version
node --version
yarn --version
git --version
```

Версии Anchor и Solana закреплены в `Anchor.toml`. Anchor 0.31.1 рекомендует Solana 2.1.0; Solana CLI 1.18.x формально старше минимума из учебного листа, но не является рекомендуемой парой для этого Anchor-проекта.

## Что уже есть

- `initialize_vault`: создаёт singleton config PDA (`config`), share-token mint PDA (`share-mint`) и ATA vault для выбранного SPL mint.
- `initialize_user`: создаёт позицию пользователя PDA (`user`, config, owner) и его ATA для share-токена.
- `set_paused`: администратор может поставить vault на паузу или снять её.
- В `VaultConfig` записаны администратор, mint базового актива, share mint, vault ATA и состояние паузы.
- `UserPosition` хранит owner, config, накопленные shares и bump.

Программа пока не принимает депозит, не выпускает shares и не взаимодействует с внешним пулом: эти операции требуют отдельных правил расчёта и интеграции.

## Сборка

```sh
anchor build
```

Для локального запуска Anchor нужны установленные Solana 2.1.0 и кошелёк по пути `~/.config/solana/id.json`. Program keypair генерируется в `target/deploy/` и исключён из Git.

## Helius

API key находится в локальном `.env`:

```env
HELIUS_API_KEY=ваш_ключ
```

`.env` игнорируется Git. Не публикуйте API key, приватный ключ кошелька или seed phrase. Значение Helius не требуется для сборки программы; оно понадобится клиенту для RPC-подключения.
