# iiRest Exporter

Chrome Extension MVP для поиска товаров в авторизованной пользовательской сессии на:

- https://gfc-russia.ru/
- https://smartpro.ru/marketplace/
- https://online.metro-cc.ru/
- https://swlife.ru/

Расширение не запрашивает и не хранит логины, пароли, cookies, токены или другие секреты. Поиск выполняется content script'ом во вкладке поставщика, где пользователь уже вошел сам.

## Development

```bash
npm install
npm run dev
npm run build
npm run build:yandex
npm test
```

## Локальная установка в Яндекс Браузер

1. Выполнить `npm install`.
2. Выполнить `npm run build:yandex`.
3. Для разработки можно открыть `browser://extensions`, включить `Режим разработчика`, нажать `Загрузить распакованное расширение` и выбрать папку `.output/yandex-mv3`.
4. Нажать иконку `iiRest Exporter (Yandex Browser)`.
5. Рабочий интерфейс откроется в отдельной вкладке расширения.

Для пользовательского пакета выполнить `npm run release:yandex` и передать папку `FOR_USER/iiRest Exporter Yandex`. Внутри будет файл `iiRest Exporter Yandex.crx`; его нужно перетащить в окно Яндекс Браузера на странице `browser://tune`. Яндекс Браузер может отключать расширения из непроверенных источников после перезапуска; в этом случае пользователь должен включить расширение снова на `browser://tune`. Для постоянного включения нужна публикация в Chrome Web Store или Opera Add-ons. См. справку Яндекса: [Extensions](https://browser.yandex.ru/help/en/personalization/extension) и [Extensions security](https://yandex.com/support/browser/en/security/check-extensions?lang=en).

## Локальная установка в Chrome

1. Выполнить `npm install`.
2. Выполнить `npm run build`.
3. Открыть `chrome://extensions`.
4. Включить `Developer mode`.
5. Нажать `Load unpacked`.
6. Выбрать папку `.output/chrome-mv3`.
7. Открыть GFC, SmartPro, METRO или Sweet Life.
8. Авторизоваться на сайте поставщика вручную.
9. Нажать иконку расширения `iiRest Exporter`.
10. Рабочий интерфейс откроется в отдельной вкладке расширения.
11. Ввести список товаров, каждый товар с новой строки.
12. Запустить поиск.
13. Скачать CSV.

## CSV

По умолчанию CSV выгружается с техническими полями:

```text
Поставщик;Исходный запрос;Наименование;Единицы измерения или упаковка;Цена;URL товара;Дата и время сбора
```

Если чекбокс служебных полей отключен:

```text
Наименование;Единицы измерения или упаковка;Цена
```

Файл формируется с разделителем `;` и UTF-8 BOM для корректного открытия в русской версии Excel.

## Обновление селекторов после проверки

Точные CSS-селекторы закрытых частей GFC, SmartPro, METRO и Sweet Life могут отличаться. После первого запуска на реальном аккаунте нужно открыть DevTools на странице поставщика и проверить:

- фактический selector поискового поля;
- selector карточки или строки товара;
- selector названия;
- selector упаковки или единицы измерения;
- selector цены;
- наличие XHR/JSON API поиска.

После проверки обновить:

- `src/lib/suppliers/gfc.adapter.ts`
- `src/lib/suppliers/smartpro.adapter.ts`
- `src/lib/suppliers/metro.adapter.ts`
- `src/lib/suppliers/sweetlife.adapter.ts`

Если найден внутренний JSON API, добавьте проверенный same-origin endpoint в `apiSearchConfigs` соответствующего адаптера. Запросы должны выполняться только с `credentials: "include"` в пользовательской авторизованной сессии. Не копируйте токены, cookies или секреты в код расширения.

## Known limitations

- Точные CSS-селекторы закрытых частей GFC, SmartPro, METRO и Sweet Life могут отличаться.
- Если сайт изменит верстку, адаптер может потребовать обновления.
- Расширение не обходит авторизацию, CAPTCHA и ограничения сайтов.
- Расширение работает только в авторизованной пользовательской сессии.
- MVP выполняет поиск последовательно, без массовых параллельных запросов.
