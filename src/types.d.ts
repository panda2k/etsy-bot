interface OfferingResponse {
    buttons: string,
    price: string,
    klarna_osm_messaging: string,
    variations: string
}

interface AtcResponse {
    cart_count: number,
    cart_tipper_html: string,
    is_cart_threshold_met: boolean
}

interface CsvTask {
    productLink: string,
    variantKeyword: string,
    quantity: number,
    useProxies: boolean,
    profileName: string,
}

interface BillingProfile {
    profile_name: string,
    country_id: number,
    name: string,
    first_line: string,
    street_name: string,
    second_line: string,
    city: string,
    state: string,
    zip: string,
    phone: string,
    email: string,
    card_number: number,
    exp_month: number,
    exp_year: number,
    cvv: number
}
