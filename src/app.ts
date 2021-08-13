import got from 'got'
import csv from 'csvtojson'
import cheerio from 'cheerio'
require('chromedriver')
import { Builder, By, until } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/chrome'
import { Preferences } from 'selenium-webdriver/lib/logging'
import { logging } from 'selenium-webdriver'

const tasksPath = './data/tasks.csv'

const loadTasks = async(): Promise<Array<Task>> => {
    return await csv({checkType: true}).fromFile(tasksPath)
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

const fetchSession = async(task: Task): Promise<string> => {
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
    const dropdowns = await driver.findElements(By.css("select[id*='variation-select-']"))

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

    // get csrf token and uaid
    const logs = await driver.manage().logs().get('performance')

    for (let i = 0; i < logs.length; i++) {
        if (logs[i].message.includes('_nnc') && (logs[i].message.includes('https://www.etsy.com/cart/listing.php') || logs[i].message.includes('https://www.etsy.com/api/v3/ajax/member/carts/add'))) {
            const logMessage = JSON.parse(logs[i].message)
            task.uaid = (await driver.manage().getCookie('uaid')).value
            try {
                const requestBody = JSON.parse(logMessage.message.params.request.postData)
                task.csrfToken = (requestBody['_nnc'])
            } catch (error) {
                const requestBody = new URLSearchParams(logMessage.message.params.request.postData)
                task.csrfToken = (requestBody.get('_nnc')) || ''
            }

        }
    }

    // remove from cart
    await driver.wait(until.elementIsEnabled(driver.findElement(By.css("a[aria-label='Remove listing']"))))
    await driver.findElement(By.css("a[aria-label='Remove listing']")).click()

    //await driver.quit()
    return 'hello'
}

const addToCart = async(task: Task) => {
    
}

(async() => {
    const tasks = await loadTasks()
    //console.log(await fetchProduct(tasks[0]))
    await fetchSession(tasks[0])
    console.log(tasks[0])
})()
