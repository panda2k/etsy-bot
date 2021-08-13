interface Task {
    productLink: string,
    variantKeyword: string,
    quantity: number,
    useProxies: boolean,
    inventoryId?: string,
    listingId?: string,
    variant?: string,
    uaid?: string,
    csrfToken?: string
}

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
