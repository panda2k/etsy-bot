import { randomBytes } from "crypto"
import got, { Got } from "got"
import { HttpsProxyAgent } from 'hpagent'
import cheerio from 'cheerio'
import { By, until, WebDriver } from "selenium-webdriver"
import { URLSearchParams } from "url"

export class Task {
    id: string
    productLink: string
    variantKeyword: string
    quantity: number
    inventoryId?: string
    listingId?: string
    variant?: string
    uaid?: string
    csrfToken?: string
    cartId?: string
    profile: BillingProfile
    guestToken?: string
    paymentToken?: string
    got: Got

    constructor(productLink: string, variantKeyword: string, quantity: number, profile: BillingProfile) {
        this.id = randomBytes(8).toString('hex')
        this.got = got.extend()
        this.productLink = productLink 
        this.variantKeyword = variantKeyword
        this.quantity = quantity
        this.profile = profile
    }

    assignProxy(proxy: Array<string>): void {
        this.got = got.extend({
            agent: {
                https: new HttpsProxyAgent({
                    keepAlive: true,
                    maxSockets: 256,
                    maxFreeSockets: 256,
                    scheduling: 'fifo',
                    proxy: `http://${proxy[2]}:${proxy[3]}@${proxy[0]}:${proxy[1]}`
                })
            }
        })
    }

    log(message: string): void {
        const currentTime = new Date(+ new Date() - new Date().getTimezoneOffset() * 60 * 1000).toISOString().substr(11,8)
        console.log(`[${this.id}]@${currentTime}: ${message}`)
    }

    testTaskConnection = async(): Promise<void> => {
        try {
            await this.got('https://etsy.com')
        } catch (error) {
            this.log('Failed to connect to Etsy')
            throw new Error('Error fetching site')
        }

        this.log('Connected to Etsy')
    }

    fetchSession = async(driver: WebDriver): Promise<void> => {
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
            await driver.findElement(By.xpath("//button[contains(string(), 'Add to cart')]")).click()  
        }   
    
        // get checkout
        try {
            await driver.wait(until.elementIsVisible(driver.findElement(By.css("a[data-selector='atc-overlay-go-to-cart-button']"))))
            await driver.findElement(By.css("a[data-selector='atc-overlay-go-to-cart-button']")).click()   
        } catch (error) {
            this.log('Straight to cart')
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
                this.uaid = (await driver.manage().getCookie('uaid')).value
                if (logs[i].message.includes('_nnc')) {
                    try {
                        const requestBody = JSON.parse(logMessage.message.params.request.postData)
                        this.csrfToken = (requestBody['_nnc'])
                    } catch (error) {
                        const requestBody = new URLSearchParams(logMessage.message.params.request.postData)
                        this.csrfToken = (requestBody.get('_nnc')) || ''
                    }
                }
            }
        }
    
        // remove from cart
        await driver.get('https://www.etsy.com/cart')
        await driver.wait(until.elementIsEnabled(driver.findElement(By.css("a[aria-label='Remove listing']"))))
        await driver.findElement(By.css("a[aria-label='Remove listing']")).click()    
    }

    getInventoryId = async(listingId: string, variant: string) => {
        this.log('Get inventory id')
        const response = (await this.got(
                `https://www.etsy.com/api/v3/ajax/bespoke/member/listings/${listingId}/offerings/find-by-variations?listing_variation_ids%5B%5D=${variant}`, 
                {responseType: 'json'}
            )).body as OfferingResponse
    
        const atcHtml = cheerio.load(response.buttons)
    
        return atcHtml('form[action="/cart/listing.php"] > input[name="listing_inventory_id"]').first().attr().value
    }
    
    fetchProduct = async() => {
        this.log('Fetch product')
        const html = (await this.got(this.productLink)).body
    
        const pageContent = cheerio.load(html)
        
        try {
            if (this.variantKeyword) {
                this.variant = pageContent(`#variation-select-0 option:contains(${this.variantKeyword})`).first().attr().value
            } else {
                const children = pageContent('#variation-select-0').children('')
                this.variant = children[Math.floor(Math.random() * children.length) + 1].attribs.value
            }
        } catch (error) {
            throw new Error('No variants available')
        }
    
        this.listingId = pageContent('input[name="listing_id"]').first().attr().value
        this.inventoryId = await this.getInventoryId(this.listingId, this.variant)
    }

    addToCart = async() => {
        const response = await this.got.post(
            'https://www.etsy.com/api/v3/ajax/member/carts/add', 
            {
                headers: {
                    cookie: `uaid=${this.uaid};`,
                    'x-csrf-token': this.csrfToken
                },
                responseType: 'json',
                json: {
                    listing_id: this.listingId,
                    quantity: this.quantity,
                    listing_inventory_id: this.inventoryId,
                    'variations%5B%5D': this.variant
                }
            }
        )
        
        const responseBody = response.body as AtcResponse
    
        //this.log(responseBody)
        if (responseBody.cart_count == 0) {
            throw Error('ATC failed')
        }
    
        const getCartResponse = await this.got(
            'https://www.etsy.com/cart',
            {
                headers: {
                    cookie: `uaid=${this.uaid};`
                }
            }
        )
    
        const html = cheerio.load(getCartResponse.body)
        this.cartId = html('input[name="cart_ids[]"]').first().attr().value
    }
    
    initiateCheckout = async() => {
        // initiate checkout
        const initiateCheckoutResponse = await this.got.post(
            `https://www.etsy.com/cart/${this.cartId}/checkout/?payment_method=cc`,
            {
                headers: {
                    cookie: `uaid=${this.uaid};`
                },
                form: {
                    guest_checkout: 1,
                    '_nnc': this.csrfToken,
                }
            }
        )
    
        this.guestToken = initiateCheckoutResponse.body.match(/guest_token"\s*:\s*"(.+?)"/)![1]
        this.log('Fetched task guest token')
    }

    submitShipping = async() => {
        const submitShippingResponse = await this.got.post(
            `https://www.etsy.com/api/v3/ajax/public/guest/${this.guestToken}/cart/${this.cartId}/address/shipping`,
            {
                headers: {
                    'x-csrf-token': this.csrfToken,
                    cookie: `uaid=${this.uaid};`
                },
                form: {
                    'address[country_id]': this.profile.country_id,
                    'address[name]': this.profile.name,
                    'address[first_line]': this.profile.first_line,
                    'address[second_line]': this.profile.second_line || '',
                    'address[city]': this.profile.city,
                    'address[state]': this.profile.state,
                    'address[zip]': this.profile.zip,
                    'address[phone]': this.profile.phone || '',
                    'address[is_default_shipping]': false,
                    'address[verification_state]': 5,
                    email: this.profile.email,
                    'messages_to_seller[0][cart_id]': this.cartId,
                    'messages_to_seller[0][message]': '',
                    'gift_messages[0][message]': '',
                    submit_blocker_checked: false,
                    submit_blocker_klarna: false,
                    supports_google_pay: false,
                    marketing_opt_in_checked: true,
                    dark_mode: false,
                    cart_id: this.cartId,
                },
                responseType: 'json'
            }
        )
    
        this.log('Submitted shipping')
    }

    getPaymentToken = async() => {
        const getPaymentTokenResponse = await this.got(
            `https://www.etsy.com/api/v3/ajax/public/guest/payments/user-id-params?cart_id=${this.cartId}&guest_token=${this.guestToken}`,
            {
                headers: {
                    cookie: `uaid=${this.uaid};`
                }
            }
        )
    
        this.paymentToken = getPaymentTokenResponse.body.replaceAll('"', '')
    
        this.log('Got payment token 1')
        await new Promise(r => setTimeout(r, 5000));
    
        // TODO fix 429 error here. maybe it is because csrf token was used too many times?
        const tokenizePaymentResponse = await this.got.post(
            `https://prod.etsypayments.com/tokenize`,
            //`https://enxphblmmtwyis.m.pipedream.net`,
            {
                form: {
                    card_number: this.profile.card_number,
                    card_cvc: this.profile.cvv,
                    card_name: this.profile.name,
                    card_expiration_month: this.profile.exp_month,
                    card_expiration_year: this.profile.exp_year,
                    nonce: this.csrfToken,
                    user_id_params: this.paymentToken
                },
                responseType: 'json'
            }
        ) as any
    
        this.paymentToken = tokenizePaymentResponse.body.data
    
        this.log('Got payment token 2')
    }

    submitPayment = async() => {
        const submitPaymentResponse = await this.got.post(
            `https://www.etsy.com/api/v3/ajax/public/guest/${this.guestToken}/cart/${this.cartId}/credit-card`,
            {
                headers: {
                    cookie: `uaid=${this.uaid};`
                },
                form: {
                    '_nnc': this.csrfToken,
                    icht_response: this.paymentToken,
                    'card[exp_mon]': this.profile.exp_month,
                    'card[exp_year]': this.profile.exp_year,
                    'card[name]': this.profile.name,
                    'save_card': true,
                    is_default_card: false,
                    cart_id: this.cartId
                },
                responseType: 'json'
            }
        )
    
        this.log(String(submitPaymentResponse.body))
    }

    checkout = async() => {
        this.log('Start checkout')
        await this.initiateCheckout()
        await new Promise(r => setTimeout(r, 10000));
        await this.submitShipping()
        await new Promise(r => setTimeout(r, 10000));
        await this.getPaymentToken()
        await new Promise(r => setTimeout(r, 10000));
        await this.submitPayment()
    }
}