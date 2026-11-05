# Solana Course

Локальная настройка окружения для разработки Solana-программ на Rust, Anchor и Node.js.

## Требования

- Rust stable через [rustup](https://rustup.rs)
- Solana CLI; для Anchor 0.31.1 рекомендуется Solana 2.1.0
- Anchor CLI 0.31.1 через AVM
- Node.js 18 или новее и npm
- Yarn
- Git
- Аккаунт Helius и API key для RPC

Проверьте установленные версии:

```sh
rustc --version
solana --version
anchor --version
node --version
npm --version
yarn --version
git --version
```

Anchor 0.31.1 рекомендует Solana 2.1.0. Если проект использует эту версию Anchor, установите соответствующую версию Solana CLI. CLI 1.18.x удовлетворяет требованию «1.18+», но не совпадает с рекомендованной для Anchor 0.31.1 версией.

## Helius API key

1. Создайте аккаунт или войдите на [helius.dev](https://helius.dev).
2. Создайте API key в панели Helius.
3. В корне проекта скопируйте `.env.example` в `.env` и укажите ключ:

   ```env
   HELIUS_API_KEY=ваш_ключ
   ```

Файл `.env` исключён из Git. Никогда не публикуйте его и не передавайте API key, приватный ключ кошелька или seed phrase.

## Зависимости проекта

Когда в репозитории появится `package.json`, установите зависимости командой `yarn install` (или командой, указанной в README проекта). Сейчас репозиторий содержит только начальную документацию, поэтому устанавливать зависимости Node.js пока не из чего.
