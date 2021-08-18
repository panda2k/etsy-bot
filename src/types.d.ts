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
    cartId?: string,
    profile: BillingProfile,
    profileName: string,
    guestToken?: string
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
    email: string
}
