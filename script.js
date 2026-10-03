// ==UserScript==
// @name              Steam Easy Currency
// @namespace         https://github.com/Ostrichbeta/steam-easy-currency
// @version           0.99
// @description       Show your local currency on the price tag while you are abroad.
// @author            Ostrichbeta Chan
// @license           MIT License
// @match             https://store.steampowered.com/*
// @match             https://steamcommunity.com/*
// @exclude           https://store.steampowered.com/cart/*
// @exclude           https://store.steampowered.com/checkout/*
// @icon              data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @require           https://code.jquery.com/jquery-3.7.1.min.js
// @connect           api.exchangerate.dev
// @connect           store.steampowered.com
// @grant             GM_xmlhttpRequest
// @grant             GM_getResourceText
// @grant             GM_addStyle
// @grant             GM_getValue
// @grant             GM_setValue
// @grant             GM_deleteValue
// @run-at            document-end
// ==/UserScript==

(async function() {

    const EXCHANGE_RATE_API_URL = "https://api.exchangerate.dev/v1";
    const API_KEY_STORAGE = "sec-exchangerate-api-key";
    const RATE_CACHE_STORAGE = "sec-exchangerate-json-cache";
    const CACHE_MAX_AGE_MS = 8 * 60 * 60 * 1000;

    function makeGetRequest(url, returnJSON, headers = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: headers,
                onload: function(response) {
                    let responseData = response.responseText;
                    try {
                        if (returnJSON) {
                            responseData = JSON.parse(response.responseText);
                        }
                    } catch (error) {
                        reject(error);
                        return;
                    }

                    if (response.status < 200 || response.status >= 300) {
                        const message = returnJSON && responseData && responseData.message
                            ? responseData.message
                            : "Request failed with HTTP status " + response.status + ".";
                        reject(new Error(message));
                        return;
                    }

                    resolve(responseData);
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }

    function engineeringNotation(num, digits) {
        let notations = {Q: 1e30, R: 1e27, Y: 1e24, Z: 1e21, 
                        E: 1e18, P: 1e15, T: 1e12, G: 1e9,
                        M: 1e6, k: 1e3
                        };
        for (const key in notations) {
            if (num / notations[key] > 1) {
                let intlen = Math.floor(Math.log10(num / notations[key]));
                return (num / notations[key]).toFixed(digits - intlen).toString() + key;
            }
        }
        return num.toString();
    }

    function getApiHeaders() {
        const apiKey = GM_getValue(API_KEY_STORAGE, "").trim();
        return apiKey == "" ? {} : { Authorization: "Bearer " + apiKey };
    }

    function getPreferredCurrency() {
        return GM_getValue("sec-currency", "USD").trim().toUpperCase();
    }

    function isValidCurrencyData(data, sourceCurrency, targetCurrency) {
        if (!data || data.result !== "success" || data.base !== sourceCurrency || !data.rates) {
            return false;
        }

        const rate = Number(data.rates[targetCurrency]);
        return Number.isFinite(rate) && rate > 0;
    }

    function getCurrencyError(data) {
        return data && (data.message || data.code)
            ? data.message || data.code
            : "exchangerate.dev returned invalid data.";
    }

    async function getSupportedCurrencies() {
        const data = await makeGetRequest(EXCHANGE_RATE_API_URL + "/currencies", true, getApiHeaders());
        if (!data || data.result !== "success" || !Array.isArray(data.currencies)) {
            throw new Error(getCurrencyError(data));
        }

        return data.currencies.map(function(currency) {
            return currency.code;
        });
    }

    async function showOptions(e) {
        e.preventDefault();

        let settingChanged = false;
        const savedCurrency = getPreferredCurrency();
        const currencyInput = prompt("Step 1: Enter new currency: ", savedCurrency);
        if (currencyInput != null) {
            const currency = currencyInput.trim().toUpperCase();
            if (!currency.match(/^[A-Z]{3}$/)) {
                alert("Invalid currency code. Enter a three-letter code such as EUR.");
                return;
            }

            try {
                const supportedCurrencies = await getSupportedCurrencies();
                if (!supportedCurrencies.includes(currency)) {
                    alert("Invalid currency code. Available input is " + supportedCurrencies.join(", ") + ".");
                    return;
                }
            } catch (error) {
                console.warn("Steam Easy Currency could not validate the currency list:", error.message || error);
            }

            if (currency !== savedCurrency) {
                GM_setValue("sec-currency", currency);
                settingChanged = true;
            }
        }

        const hideOriginalPrice = prompt("Step 2: Hide the original price? Input 1 to hide it or 0 to keep it.", GM_getValue("sec-hide-original", "0"));
        if (hideOriginalPrice != null) {
            if (hideOriginalPrice == "0" || hideOriginalPrice == "1") {
                if (hideOriginalPrice !== GM_getValue("sec-hide-original", "0")) {
                    GM_setValue("sec-hide-original", hideOriginalPrice);
                    settingChanged = true;
                }
            } else {
                alert("Invalid input.");
                return;
            }
        }

        const savedApiKey = GM_getValue(API_KEY_STORAGE, "");
        const apiKey = prompt("Step 3: Optional exchangerate.dev API key. Leave blank to use anonymous access.", savedApiKey);
        if (apiKey != null && apiKey.trim() !== savedApiKey) {
            if (apiKey.trim() == "") {
                GM_deleteValue(API_KEY_STORAGE);
            } else {
                GM_setValue(API_KEY_STORAGE, apiKey.trim());
            }
            settingChanged = true;
        }

        if (settingChanged) {
            GM_deleteValue(RATE_CACHE_STORAGE);
            location.reload();
        }
    }

    function bindOptions() {
        $(".sec-options").off("click.sec-options").on("click.sec-options", function(e) {
            void showOptions(e);
        });
    }

    function appendPrice(priceObjList, currencyJSON, appendBr) {
        for (let i = 0; i < priceObjList.length; i++) {
            var item = priceObjList[i];
            if (! $(item).text().replaceAll(/\s/g,'').match(/[\d,]+(?:\.\d+)?/)) {
                // When there are no price tags, e.g. free contents.
                continue;
            }
            if ($(item).children().length > 0 && (! $(item).children().first().hasClass("your_price_label"))) {
                // When the price tag is embedded inside the div
                continue;
            }

            if ($(item).children().first().hasClass("your_price_label")) {
                // When the price tag is embedded inside the div
                item = $(item).children().eq(1);
            }

            if ($(item).hasClass("price-appended")) {
                continue;
            }

            var currentPrice = parseFloat($(item).text().replaceAll(/\s/g,'').replaceAll(/,/g, '').match(/[\d,]+(?:\.\d+)?/)[0]);
            
            var preferCurrency = getPreferredCurrency();
            let priceTag = currencyJSON["base"];
            if (preferCurrency == priceTag) {
                var convertRate = 1;
                return
            } else {
                if (!Object.prototype.hasOwnProperty.call(currencyJSON["rates"], preferCurrency)) {
                    alert("Invalid currency mark " + preferCurrency + ".");
                    break;
                }
                
                var convertRate = Number(currencyJSON["rates"][preferCurrency]);
            }
            
            let hideOriginalPrice = GM_getValue("sec-hide-original", "0");
            if (hideOriginalPrice == "0") {
                $(item).append(" " + "(" + ((convertRate * currentPrice > 1e5) ? engineeringNotation(convertRate * currentPrice, 4) : (convertRate * currentPrice).toFixed(2).toString()) + "&nbsp;" + preferCurrency + ")");
            } else {
                $(item).text("");
                $(item).append((convertRate * currentPrice).toFixed(2) + " " + preferCurrency);
            }
            $(item).addClass("price-appended");
        }
    }

    function addCurrencyHint(currencyJSON) {
        var discountNumList = $(".discount_final_price")
        if (window.location.href.match(/^https\:\/\/store\.steampowered\.com\/search\/.*$/)) {
            appendPrice(discountNumList, currencyJSON, true);
            $(discountNumList).css("text-align", "right");
        } else {
            appendPrice(discountNumList, currencyJSON, false);
        }

        var priceList = $(".price")
        appendPrice(priceList, currencyJSON, false);

        var dlcPriceList = $(".game_area_dlc_price")
        appendPrice(dlcPriceList, currencyJSON, false);

        // Keep the old selector as a fallback, and use Steam's stable widget
        // class for the current generated markup.
        var salesPrice = $(".salepreviewwidgets_StoreSalePriceBox_Wh0L8")
        $(".StoreSalePriceWidgetContainer").each(function () {
            var priceElement = $(this).children().last();
            while (priceElement.children().length > 0) {
                priceElement = priceElement.children().last();
            }
            salesPrice = salesPrice.add(priceElement);
        });
        appendPrice(salesPrice, currencyJSON, false);

        var searchSubtitle = $(".match_subtitle").filter(function () {
            return ($(this).parent().hasClass("match_app"));
        })
        appendPrice(searchSubtitle, currencyJSON, false);
    }

    async function initData() {
        try {
            // Product pages already expose the account currency. Only make a
            // second Steam request on pages where that metadata is absent.
            let priceObj = $("meta[itemprop=\"priceCurrency\"]").first();
            if (priceObj.length < 1) {
                const steamWebPage = await makeGetRequest("https://store.steampowered.com/app/304430/INSIDE/", false);
                const jqSteamPage = $($.parseHTML(steamWebPage));
                priceObj = jqSteamPage.find("meta[itemprop=\"priceCurrency\"]").first();
            }
            if (priceObj.length < 1) {
                throw new Error("Could not find the price tag!");
            }
            const priceTag = priceObj.attr("content").toUpperCase();
            const targetCurrency = getPreferredCurrency();
            console.log("Your currency in Steam is " + priceTag + ".");
            if (!targetCurrency.match(/^[A-Z]{3}$/)) {
                throw new Error("Invalid saved target currency " + targetCurrency + ".");
            }
            if (priceTag == targetCurrency) {
                return {
                    result: "success",
                    base: priceTag,
                    rates: { [targetCurrency]: 1 }
                };
            }

            let currencyJSON = {};
            let refreshCurrency = false;

            // Check cached data to reduce API call
            try{
                if (GM_getValue(RATE_CACHE_STORAGE) != undefined){
                    let cachedOBJ = JSON.parse(GM_getValue(RATE_CACHE_STORAGE));
                    if (Date.now() - cachedOBJ.cachedAt < CACHE_MAX_AGE_MS
                        && cachedOBJ.source === priceTag
                        && cachedOBJ.target === targetCurrency
                        && isValidCurrencyData(cachedOBJ.data, priceTag, targetCurrency)) {
                        // Cache the currency data for 8 hours
                        currencyJSON = cachedOBJ.data;
                    } else {
                        refreshCurrency = true;
                    }
                } else {
                    refreshCurrency = true;
                }
            } catch (error) {
                console.error(error);
                refreshCurrency = true;
            }

            if (refreshCurrency) {
                const requestURL = EXCHANGE_RATE_API_URL + "/latest/" + encodeURIComponent(priceTag)
                    + "?symbols=" + encodeURIComponent(targetCurrency);
                currencyJSON = await makeGetRequest(requestURL, true, getApiHeaders());
                if (!isValidCurrencyData(currencyJSON, priceTag, targetCurrency)) {
                    throw new Error(getCurrencyError(currencyJSON));
                }
                GM_setValue(RATE_CACHE_STORAGE, JSON.stringify({
                    cachedAt: Date.now(),
                    source: priceTag,
                    target: targetCurrency,
                    data: currencyJSON
                }));
                console.log("Currency data refreshed.");
            }

            if (!isValidCurrencyData(currencyJSON, priceTag, targetCurrency)) {
                throw new Error(getCurrencyError(currencyJSON));
            }
            
            return currencyJSON;

        } catch (error) {
            console.warn("Steam Easy Currency could not load exchange rates:", error.message || error);
            return null;
        }
    }

    const sec_options_caption = "SEC OPTIONS";

    $(".sec-options").remove();
    $("#account_dropdown > div.popup_menu").first().append("<a class=\"popup_menu_item sec-options\"  href=\"#\"> " + sec_options_caption + " </a>");
    $("div.minor_menu_items").append("<a class=\"menuitem sec-options\" href=\"#\"> " + sec_options_caption + " </a>");
    bindOptions();
    const currencyJSON = await initData();
    if (currencyJSON && currencyJSON["base"] && currencyJSON["rates"] && currencyJSON["base"] != getPreferredCurrency()) {
        addCurrencyHint(currencyJSON);
        setInterval(addCurrencyHint, 500, currencyJSON);
    } else if (currencyJSON && currencyJSON["base"] == getPreferredCurrency()) {
        console.log("The currency of your account is the same as the one you wanna display, abort.");
    }
})();
