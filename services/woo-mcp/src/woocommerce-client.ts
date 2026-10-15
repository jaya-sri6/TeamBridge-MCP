export interface WooProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  price: string;
  regular_price: string;
  status: string;
  stock_status: string;
  description: string;
  short_description: string;
  categories: Array<{ id: number; name: string; slug: string }>;
  images?: Array<{ id: number; src: string; name?: string; alt?: string }>;
}

export interface WooOrder {
  id: number;
  status: string;
  currency: string;
  date_created: string;
  total: string;
  customer_id: number;
  billing: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  };
  line_items: Array<{
    id: number;
    name: string;
    product_id: number;
    quantity: number;
    subtotal: string;
    total: string;
  }>;
}

export interface WooConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  timeoutMs?: number;
}

export class WooCommerceClient {
  private baseUrl: string;
  private consumerKey: string;
  private consumerSecret: string;
  private timeoutMs: number;

  constructor(config: WooConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.consumerKey = config.consumerKey;
    this.consumerSecret = config.consumerSecret;
    this.timeoutMs = config.timeoutMs || 8000;
  }

  private getAuthHeaders(): Record<string, string> {
    const token = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString("base64");
    return {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private buildUrl(path: string, queryParams: Record<string, string | number | undefined> = {}): string {
    const url = new URL(`${this.baseUrl}/wp-json/wc/v3/${path.replace(/^\/+/, "")}`);
    
    // Also include credentials in query string as fallback for HTTP setups
    if (this.consumerKey) {
      url.searchParams.set("consumer_key", this.consumerKey);
    }
    if (this.consumerSecret) {
      url.searchParams.set("consumer_secret", this.consumerSecret);
    }

    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    body?: any,
    queryParams?: Record<string, string | number | undefined>
  ): Promise<T> {
    const url = this.buildUrl(path, queryParams);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: this.getAuthHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorData: any = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText || response.statusText };
        }
        throw new Error(
          `WooCommerce API error (${response.status}): ${errorData.message || errorText || response.statusText}`
        );
      }

      return (await response.json()) as T;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error(`WooCommerce API request to '${path}' timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async listProducts(params: {
    page?: number;
    per_page?: number;
    search?: string;
    category?: string;
    stock_status?: string;
  } = {}): Promise<WooProduct[]> {
    return this.request<WooProduct[]>("products", "GET", undefined, {
      page: params.page || 1,
      per_page: params.per_page || 20,
      search: params.search,
      category: params.category,
      stock_status: params.stock_status,
    });
  }

  async createProduct(data: {
    name: string;
    regular_price: string;
    description?: string;
    short_description?: string;
    category_names?: string[];
    images?: Array<{ src?: string; id?: number }>;
  }): Promise<WooProduct> {
    const payload: any = {
      name: data.name,
      type: "simple",
      regular_price: data.regular_price,
      description: data.description || "",
      short_description: data.short_description || "",
      manage_stock: false,
      status: "publish",
    };

    if (data.images && data.images.length > 0) {
      payload.images = data.images;
    }

    return this.request<WooProduct>("products", "POST", payload);
  }

  async listOrders(params: {
    page?: number;
    per_page?: number;
    status?: string;
    after?: string;
    before?: string;
  } = {}): Promise<WooOrder[]> {
    return this.request<WooOrder[]>("orders", "GET", undefined, {
      page: params.page || 1,
      per_page: params.per_page || 20,
      status: params.status,
      after: params.after,
      before: params.before,
    });
  }

  async getOrder(id: number): Promise<WooOrder> {
    return this.request<WooOrder>(`orders/${id}`, "GET");
  }

  async updateOrderStatus(id: number, status: string): Promise<WooOrder> {
    return this.request<WooOrder>(`orders/${id}`, "PUT", { status });
  }

  async testConnection(): Promise<{ ok: boolean; status: string; productsCount: number }> {
    try {
      const products = await this.listProducts({ per_page: 1 });
      return { ok: true, status: "Connected", productsCount: products.length };
    } catch (err: any) {
      return { ok: false, status: err.message, productsCount: 0 };
    }
  }
}
