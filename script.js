// ==UserScript==
// @name              Steam Easy Currency
// @namespace         https://github.com/Ostrichbeta/steam-easy-currency
// @version           0.95.0
// @description       Show your local currency on the price tag while you are abroad.
// @author            Ostrichbeta Chan
// @license           MIT License
// @match             https://store.steampowered.com/*
// @match             https://steamcommunity.com/*
// @exclude           https://store.steampowered.com/cart/*
// @exclude           https://store.steampowered.com/checkout/*
// @icon              data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @require           https://code.jquery.com/jquery-3.7.1.min.js
// @connect           api.exchangerate.host
// @connect           store.steampowered.com
// @grant             GM_xmlhttpRequest
// @grant             GM_getResourceText
// @grant             GM_addStyle
// @grant             GM_getValue
// @grant             GM_setValue
// @run-at            document-end
// ==/UserScript==

(async function() {

    function makeGetRequest(url, returnJSON) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: function(response) {
                    if (returnJSON) {
                        resolve(JSON.parse(response.responseText));
                    } else {
                        resolve(response.responseText);
                    }
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }

    function appendPrice(priceObjList, currencyJSON, appendBr) {
        for (let i = 0; i < priceObjList.length; i++) {
            var item = priceObjList[i];
            if (! $(item).text().replaceAll(/\s/g,'').match(/[\d,]+\.\d+/)) {
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

            var currentPrice = parseFloat($(item).text().replaceAll(/\s/g,'').match(/[\d,]+\.\d+/)[0]);
            
            var preferCurrency = GM_getValue("sec-currency", "USD");
            if (!(currencyJSON['rates']).hasOwnProperty(preferCurrency)) {
                alert("Invalid currency mark " + preferCurrency + ".");
                break;
            }
            
            var convertRate = currencyJSON['rates'][preferCurrency];
            let hideOriginalPrice = GM_getValue("sec-hide-original", "0");
            if (hideOriginalPrice == "0") {
                $(item).append(" " + "(" + (convertRate * currentPrice).toFixed(2) + "&nbsp;" + preferCurrency + ")");
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

        var searchSubtitle = $(".match_subtitle").filter(function () {
            return ($(this).parent().hasClass("match_app"));
        })
        appendPrice(searchSubtitle, currencyJSON, false);
    }

    async function initData() {
        try {
            const steamWebPage = await makeGetRequest("https://store.steampowered.com/app/304430/INSIDE/", false) // For fetching the priceTag
            const jqSteamPage = $($.parseHTML(steamWebPage));
            const priceObj = jqSteamPage.find("meta[itemprop=\"priceCurrency\"]");
            if (priceObj.length < 1) {
                throw new Error("Could not find the price tag!");
            }
            const priceTag = $(priceObj[0]).attr("content");
            console.log("Your currency in Steam is " + priceTag + ".");
            const currencyJSON = await makeGetRequest("https://api.exchangerate.host/latest?base=" + priceTag, true);
            
            
            $(".sec-options").click(function (e) { 
                e.preventDefault();
                let currency = prompt("Step 1: Enter new currency: ", GM_getValue("sec-currency", "USD"));
                let settingChanged = false;
                if (currency != null) {
                    if (!Object.keys(currencyJSON['rates']).includes(currency)) {
                        alert("Invalid currency tag, avaliable input is " + Object.keys(currencyJSON['rates']).join(", ") + ".");
                    } else {
                        GM_setValue("sec-currency", currency);
                        settingChanged = true;
                    }
                }
                let hideOriginalPrice = prompt("Step 2: Hide the original price or not? Input 1 to agree.", GM_getValue("sec-hide-original", "0"));
                if (hideOriginalPrice != null) {
                    switch (hideOriginalPrice) {
                        case "1":
                            //hide

                        case "0":
                            GM_setValue("sec-hide-original", hideOriginalPrice);
                            settingChanged = true;
                            //show
                            break
                    
                        default:
                            alert("Invalid input.");
                            break;
                    }
                }
                if (settingChanged) {
                    location.reload();
                }
            });
            
            return currencyJSON;

        } catch (error) {
            console.error("An error occurred while fetching data.", error)
        }
    }

    $("div.popup_menu").append("<a class=\"popup_menu_item sec-options\"  href=\"#\"> SEC OPTIONS </a>");
    $("div.minor_menu_items").append("<a class=\"menuitem sec-options\" href=\"#\"> SEC OPTIONS </a>");
    const currencyJSON = await initData();
    if (currencyJSON["base"] != GM_getValue("sec-currency", "USD")) {
        setInterval(addCurrencyHint, 500, currencyJSON);
    } else {
        console.log("The currency of your account is the same as the one you wanna display, abort.");
    }
})();