import got, { Got } from 'got'
import csv from 'csvtojson'
import cheerio from 'cheerio'
require('chromedriver')
import { Builder, By, until, WebDriver } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/chrome'
import { Preferences } from 'selenium-webdriver/lib/logging'
import { logging } from 'selenium-webdriver'
import { HttpsProxyAgent } from 'hpagent'
import { readFileSync } from 'fs'

const tasksPath = './data/tasks.csv'
const profilesPath = './data/profiles.csv'
const proxiesPath = './data/proxies.txt'

const createWebdriver = async(): Promise<WebDriver> => {
    // set up network logging to intercept csrf token
    const chromeOptions = new Options
    const loggingPreferences = new Preferences()
    loggingPreferences.setLevel(logging.Type.PERFORMANCE, logging.Level.ALL)

    chromeOptions.setLoggingPrefs(loggingPreferences)
    chromeOptions.setPerfLoggingPrefs({enableNetwork: true})
    const driver = await new Builder().forBrowser('chrome').setChromeOptions(chromeOptions).build()

    return driver
}

const loadTasks = async(): Promise<Array<Task>> => {
    const tasks: Array<Task> = await csv({checkType: true}).fromFile(tasksPath)
    const profiles: Array<BillingProfile> = await csv({checkType: true}).fromFile(profilesPath)
    const proxies: Array<string> = readFileSync(proxiesPath).toString('utf-8').split('\n')

    for (let i = 0; i < tasks.length; i++) {
        for (let j = 0; j < tasks.length; j++) {
            if (tasks[i].profileName == profiles[j].profile_name) {
                tasks[i].profile = profiles[j]
            }
        }
        if (tasks[i].useProxies) {
            const taskProxy = proxies[i % proxies.length].split(':')
            console.log(`https://${taskProxy[2]}:${taskProxy[3]}@${taskProxy[0]}:${taskProxy[1]}`)
            tasks[i].got = got.extend({
                agent: {
                    https: new HttpsProxyAgent({
                        keepAlive: true,
                        maxSockets: 256,
                        maxFreeSockets: 256,
                        scheduling: 'fifo',
                        proxy: `http://${taskProxy[2]}:${taskProxy[3]}@${taskProxy[0]}:${taskProxy[1]}`
                    })
                }
            })
        } else {
            tasks[i].got = got.extend()
        }
    }

    return tasks
}

const testTaskConnection = async(task: Task) => {
    console.log((await task.got('https://api.ipify.org?format=json', { responseType: 'json' })).body)
    await task.got('https://etsy.com')
}

const getInventoryId = async(got: Got, listingId: string, variant: string) => {
    console.log('Get inventory id')
    const response = (await got(
            `https://www.etsy.com/api/v3/ajax/bespoke/member/listings/${listingId}/offerings/find-by-variations?listing_variation_ids%5B%5D=${variant}`, 
            {responseType: 'json'}
        )).body as OfferingResponse

    const atcHtml = cheerio.load(response.buttons)

    return atcHtml('form[action="/cart/listing.php"] > input[name="listing_inventory_id"]').first().attr().value
}

const fetchProduct = async(task: Task) => {
    console.log('Fetch product')
    const html = (await task.got(task.productLink)).body

    const pageContent = cheerio.load(html)

    if (task.variantKeyword) {
        task.variant = pageContent(`#variation-select-0 option:contains(${task.variantKeyword})`).first().attr().value
    } else {
        const children = pageContent('#variation-select-0').children('')
        task.variant = children[Math.floor(Math.random() * children.length) + 1].attribs.value
    }

    task.listingId = pageContent('input[name="listing_id"]').first().attr().value
    task.inventoryId = await getInventoryId(task.got, task.listingId, task.variant)
}

const fetchSession = async(task: Task, driver: WebDriver): Promise<void> => {
    await driver.get('https://etsy.com')

    // click first popular product
    await driver.wait(until.elementIsVisible(driver.findElement(By.className("wt-block-grid__item"))), 7000)
    await driver.findElement(By.className("wt-block-grid__item")).click()

    await driver.wait(until.elementIsVisible(driver.findElement(By.css("button[type='submit']"))), 7000)
    
    // switch to new product tab
    const tabs = await driver.getAllWindowHandles()
    await driver.switchTo().window(tabs[1])

    // select random variations from dropdowns
    const dropdowns = await driver.findElements(By.css("select[id^='variation-select-']"))

    for (let i = 0; i < dropdowns.length; i++) {
        await driver.wait(until.elementIsEnabled(driver.findElement(By.css(`select[id='variation-select-${i}']`))), 5000)
        const options = await driver.findElements(By.css(`select[id='variation-select-${i}'] > option`))
        await options[Math.ceil(Math.random() * (options.length - 1))].click()
    }

    // add to cart
    try {
        await driver.wait(until.elementIsEnabled(driver.findElement(By.xpath("//button[contains(string(), 'Add to cart')]"))))
    } catch (error) {
        await driver.wait(until.elementIsEnabled(driver.findElement(By.xpath("//button[contains(string(), 'Add to cart')]"))))   
    }
    await driver.findElement(By.xpath("//button[contains(string(), 'Add to cart')]")).click()

    // get checkout
    try {
        await driver.wait(until.elementIsVisible(driver.findElement(By.css("a[data-selector='atc-overlay-go-to-cart-button']"))))
        await driver.findElement(By.css("a[data-selector='atc-overlay-go-to-cart-button']")).click()   
    } catch (error) {
        console.log('Straight to cart')
    }

    await driver.wait(until.elementIsEnabled(driver.findElement(By.className('proceed-to-checkout'))))
    await driver.findElement(By.className('proceed-to-checkout')).click()

    await driver.wait(until.elementLocated((By.xpath('//button[contains(string(), "Continue as a guest")]'))), 5000)
    await driver.findElement(By.xpath('//button[contains(string(), "Continue as a guest")]')).click()

    // get csrf token and uaid
    const logs = await driver.manage().logs().get('performance')

    for (let i = 0; i < logs.length; i++) {
        if ((logs[i].message.includes('payment_method=cc'))) {
            const logMessage = JSON.parse(logs[i].message)
            task.uaid = (await driver.manage().getCookie('uaid')).value
            if (logs[i].message.includes('_nnc')) {
                try {
                    const requestBody = JSON.parse(logMessage.message.params.request.postData)
                    task.csrfToken = (requestBody['_nnc'])
                } catch (error) {
                    const requestBody = new URLSearchParams(logMessage.message.params.request.postData)
                    task.csrfToken = (requestBody.get('_nnc')) || ''
                }
            }
        }
    }

    // remove from cart
    await driver.get('https://www.etsy.com/cart')
    await driver.wait(until.elementIsEnabled(driver.findElement(By.css("a[aria-label='Remove listing']"))))
    await driver.findElement(By.css("a[aria-label='Remove listing']")).click()

    //await driver.quit()
}

const addToCart = async(task: Task) => {
    const response = await task.got.post(
        'https://www.etsy.com/api/v3/ajax/member/carts/add', 
        {
            headers: {
                cookie: `uaid=${task.uaid};`,
                'x-csrf-token': task.csrfToken
            },
            responseType: 'json',
            json: {
                listing_id: task.listingId,
                quantity: task.quantity,
                listing_inventory_id: task.inventoryId,
                'variations%5B%5D': task.variant
            }
        }
    )
    
    const responseBody = response.body as AtcResponse

    //console.log(responseBody)
    if (responseBody.cart_count == 0) {
        throw Error('ATC failed')
    }

    const getCartResponse = await task.got(
        'https://www.etsy.com/cart',
        {
            headers: {
                cookie: `uaid=${task.uaid};`
            }
        }
    )

    const html = cheerio.load(getCartResponse.body)
    task.cartId = html('input[name="cart_ids[]"]').first().attr().value
}

const checkout = async(task: Task) => {
    console.log('Start checkout')

    // initiate checkout
    const initiateCheckoutResponse = await task.got.post(
        `https://www.etsy.com/cart/${task.cartId}/checkout/?payment_method=cc`,
        {
            headers: {
                cookie: `uaid=${task.uaid};`
            },
            form: {
                guest_checkout: 1,
                '_nnc': task.csrfToken,
            }
        }
    )

    task.guestToken = initiateCheckoutResponse.body.match(/guest_token"\s*:\s*"(.+?)"/)![1]
    console.log('Fetched task guest token')
    
    const submitShippingResponse = await task.got.post(
        `https://www.etsy.com/api/v3/ajax/public/guest/${task.guestToken}/cart/${task.cartId}/address/shipping`,
        {
            headers: {
                'x-csrf-token': task.csrfToken,
                cookie: `uaid=${task.uaid};`
            },
            form: {
                'address[country_id]': task.profile.country_id,
                'address[name]': task.profile.name,
                'address[first_line]': task.profile.first_line,
                'address[second_line]': task.profile.second_line || '',
                'address[city]': task.profile.city,
                'address[state]': task.profile.state,
                'address[zip]': task.profile.zip,
                'address[phone]': task.profile.phone || '',
                'address[is_default_shipping]': false,
                'address[verification_state]': 5,
                email: task.profile.email,
                'messages_to_seller[0][cart_id]': task.cartId,
                'messages_to_seller[0][message]': '',
                'gift_messages[0][message]': '',
                submit_blocker_checked: false,
                submit_blocker_klarna: false,
                supports_google_pay: false,
                marketing_opt_in_checked: true,
                dark_mode: false,
                cart_id: task.cartId,
            },
            responseType: 'json'
        }
    )

    console.log('Submitted shipping')

    const getPaymentTokenResponse = await task.got(
        `https://www.etsy.com/api/v3/ajax/public/guest/payments/user-id-params?cart_id=${task.cartId}&guest_token=${task.guestToken}`,
        {
            headers: {
                cookie: `uaid=${task.uaid};`
            }
        }
    )

    task.paymentToken = getPaymentTokenResponse.body.replace('"', '')

    console.log('task.got payment token 1')

    const tokenizeOptionsResponse = await task.got(
        `https://prod.etsypayments.com/tokenize`,
        {
            'method': 'OPTIONS'
        }
    )

    // TODO fix 429 error here. maybe it is because csrf token was used too many times?
    const tokenizePaymentResponse = await task.got.post(
        `https://prod.etsypayments.com/tokenize`,
        {
            form: {
                card_number: task.profile.card_number,
                card_cvc: task.profile.cvv,
                card_name: task.profile.name,
                card_expiration_month: task.profile.exp_month,
                card_expiration_year: task.profile.exp_year,
                nonce: task.csrfToken,
                user_id_params: task.paymentToken
            },
            responseType: 'json'
        }
    ) as any

    task.paymentToken = tokenizePaymentResponse.body.data

    console.log('Got payment token 2')

    const submitPaymentResponse = await task.got.post(
        `https://www.etsy.com/api/v3/ajax/public/guest/${task.guestToken}/cart/${task.cartId}/credit-card`,
        {
            headers: {
                cookie: `uaid=${task.uaid};`
            },
            form: {
                '_nnc': task.csrfToken,
                icht_response: task.paymentToken,
                'card[exp_mon]': task.profile.exp_month,
                'card[exp_year]': task.profile.exp_year,
                'card[name]': task.profile.name,
                'save_card': true,
                is_default_card: false,
                cart_id: task.cartId
            },
            responseType: 'json'
        }
    )

    console.log(submitPaymentResponse.body)
}

(async() => {
    const driver = await createWebdriver()
    const tasks = await loadTasks()
    await testTaskConnection(tasks[0])
    await fetchSession(tasks[0], driver)
    await fetchProduct(tasks[0])
    await addToCart(tasks[0])
    await checkout(tasks[0])
    console.log(tasks[0])
})()
