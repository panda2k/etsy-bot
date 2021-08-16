import got from 'got'
import csv from 'csvtojson'
import cheerio from 'cheerio'
require('chromedriver')
import { Builder, By, until } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/chrome'
import { Preferences } from 'selenium-webdriver/lib/logging'
import { logging } from 'selenium-webdriver'

const tasksPath = './data/tasks.csv'
const profilesPath = './data/profiles.csv'

const loadTasks = async(): Promise<Array<Task>> => {
    const tasks: Array<Task> = await csv({checkType: true}).fromFile(tasksPath)
    const profiles: Array<BillingProfile> = await csv({checkType: true}).fromFile(profilesPath)

    for (let i = 0; i < tasks.length; i++) {
        for (let j = 0; j < tasks.length; j++) {
            if (tasks[i].profileName == profiles[j].profile_name) {
                tasks[i].profile = profiles[j]
            }
        }
    }

    return tasks
}

const getInventoryId = async(listingId: string, variant: string) => {
    const response = (await got(
            `https://www.etsy.com/api/v3/ajax/bespoke/member/listings/${listingId}/offerings/find-by-variations?listing_variation_ids%5B%5D=${variant}`, 
            {responseType: 'json'}
        )).body as OfferingResponse

    const atcHtml = cheerio.load(response.buttons)

    return atcHtml('form[action="/cart/listing.php"] > input[name="listing_inventory_id"]').first().attr().value
}

const fetchProduct = async(task: Task) => {
    const html = (await got(task.productLink)).body

    const pageContent = cheerio.load(html)

    if (task.variantKeyword) {
        task.variant = pageContent(`#variation-select-0 option:contains(${task.variantKeyword})`).first().attr().value
    } else {
        const children = pageContent('#variation-select-0').children('')
        task.variant = children[Math.floor(Math.random() * children.length) + 1].attribs.value
    }

    task.listingId = pageContent('input[name="listing_id"]').first().attr().value
    task.inventoryId = await getInventoryId(task.listingId, task.variant)
}

const fetchSession = async(task: Task): Promise<void> => {
    // set up network logging to intercept csrf token
    const chromeOptions = new Options
    const loggingPreferences = new Preferences()
    loggingPreferences.setLevel(logging.Type.PERFORMANCE, logging.Level.ALL)

    chromeOptions.setLoggingPrefs(loggingPreferences)
    chromeOptions.setPerfLoggingPrefs({enableNetwork: true})
    const driver = await new Builder().forBrowser('chrome').setChromeOptions(chromeOptions).build()

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
    const response = await got.post(
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

    const getCartResponse = await got(
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
    // initiate checkout
    const initiateCheckoutResponse = await got.post(
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
    ).then(response => {
        console.log(response.body)
    })
    .catch(error => {
        console.log(error.response.body)
    })

    /*const verifyAddressResponse = await got.post(
        `https://www.etsy.com/api/v3/ajax/public/addresses/validate`,
        {
            headers: {
                cookie: `uaid=${task.uaid}`
            },
            json: {
                address: {
                    country_id: task.profile.country_id,
                    name: task.profile.name,
                    first_line: task.profile.first_line,
                    street_name: task.profile.street_name || '',
                    street_number: '',
                    second_line: task.profile.second_line,
                    city: task.profile.city,
                    state: task.profile.state,
                    zip: task.profile.zip,
                    phone: task.profile.phone,
                    is_default_shipping: false,
                    verification_state: 0,
                },
                field_name: 'state',
                restrict_to_installments_billing_countries: false
            }
        }
    )

    console.log(verifyAddressResponse)*/
}

(async() => {
    const tasks = await loadTasks()
    await fetchProduct(tasks[0])
    await fetchSession(tasks[0])
    await addToCart(tasks[0])
    console.log(tasks[0])
    await checkout(tasks[0])
})()
