import got from 'got'
import csv from 'csvtojson'
import cheerio from 'cheerio'
import { randomBytes } from 'crypto'

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

const addToCart = async(task: Task) => {
    
}

(async() => {
    const tasks = await loadTasks()
    console.log(await fetchProduct(tasks[0]))
    console.log(tasks[0])
})()
