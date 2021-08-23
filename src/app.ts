import csv from 'csvtojson'
require('chromedriver')
import { Builder, By, until, WebDriver } from 'selenium-webdriver'
import { Options } from 'selenium-webdriver/chrome'
import { Preferences } from 'selenium-webdriver/lib/logging'
import { logging } from 'selenium-webdriver'
import { readFileSync } from 'fs'
import { Task } from './classes'

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
    const importedTasks: Array<CsvTask> = await csv({checkType: true}).fromFile(tasksPath)
    const tasks: Array<Task> = []
    const profiles: Array<BillingProfile> = await csv({checkType: true}).fromFile(profilesPath)
    const proxies: Array<string> = readFileSync(proxiesPath).toString('utf-8').split('\n')

    for (let i = 0; i < importedTasks.length; i++) {
        for (let j = 0; j < profiles.length; j++) {
            let taskProfile
            if (importedTasks[i].profileName == profiles[j].profile_name) {
                taskProfile = profiles[j]
            }


            if (!taskProfile) {
                throw new Error('Task profile not found')
            }
            
            const task = new Task(importedTasks[i].productLink, importedTasks[i].variantKeyword, importedTasks[i].quantity, taskProfile)
        
            if (importedTasks[i].useProxies) {
                task.assignProxy(proxies[i % proxies.length].split(':'))
            }
    
            tasks.push(task)
        }
    }

    return tasks
}

const taskFlow = async(driver: WebDriver, task: Task): Promise<void> => {
    await task.testTaskConnection()
    await task.fetchSession(driver)
    while (true) {
        try {
            await task.fetchProduct()
            break
        } catch (error) {
            task.log('No variants available')
            await new Promise(r => setTimeout(r, 3500));
        }
    }
    await task.addToCart()
    await task.checkout()
}

(async() => {
    const driver = await createWebdriver()
    const tasks = await loadTasks()
    Promise.all(
        tasks.map(async(task) => {
            return taskFlow(driver, task)
        })
    )
})()
