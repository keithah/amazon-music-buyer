import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { MusicItem, PriceInfo } from './types.js';

export class AmazonMusicScraper {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private headless: boolean;
  private delay: number;
  private maxRetries: number;

  constructor(options: { headless?: boolean; delay?: number; maxRetries?: number } = {}) {
    this.headless = options.headless ?? true;
    this.delay = options.delay ?? 2000;
    this.maxRetries = options.maxRetries ?? 3;
  }

  async initialize(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor'
      ]
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    this.page = await this.context.newPage();
    
    // Block unnecessary resources to speed up loading
    await this.page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'stylesheet', 'font'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
  }

  async close(): Promise<void> {
    if (this.page) await this.page.close();
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }

  private extractPrice(priceText: string): number {
    // Clean the text
    const cleanText = priceText.replace(/[\n\t]/g, '').trim();
    
    // Look for currency patterns
    const patterns = [
      /\$(\d+\.\d{2})/,           // $1.29
      /\$(\d+)/,                 // $1
      /(\d+)\.(\d{2})/,          // 1.29
      /(\d+)\s*\.\s*(\d{2})/,    // 1 . 29
    ];

    for (const pattern of patterns) {
      const match = cleanText.match(pattern);
      if (match) {
        if (match.length === 2) {
          const price = parseFloat(match[1]);
          if (price > 0 && price < 50) return price;
        } else if (match.length === 3) {
          const price = parseFloat(`${match[1]}.${match[2]}`);
          if (price > 0 && price < 50) return price;
        }
      }
    }

    return 0;
  }

  async searchForTrack(item: MusicItem): Promise<PriceInfo> {
    if (!this.page) throw new Error('Scraper not initialized');

    const result: PriceInfo = {
      ...item,
      trackPrice: 0,
      available: false,
      searchQuery: `${item.artist} ${item.song}${item.album ? ` ${item.album}` : ''}`,
    };

    console.log(`🔍 Searching for: ${result.searchQuery}`);

    try {
      // Navigate to Amazon Digital Music search
      const searchQuery = encodeURIComponent(`${result.searchQuery} mp3`);
      const searchUrl = `https://www.amazon.com/s?k=${searchQuery}&i=digital-music&rh=n%3A163856011,p_n_format_browse-bin%3A625007011`;
      
      await this.page.goto(searchUrl, { waitUntil: 'networkidle' });
      await this.page.waitForTimeout(this.delay);

      // Look for search results
      const results = await this.page.locator('[data-component-type="s-search-result"]').all();
      
      if (results.length === 0) {
        result.error = 'No search results found';
        return result;
      }

      // Check first few results for MP3 tracks
      for (let i = 0; i < Math.min(results.length, 5); i++) {
        const resultElement = results[i];
        
        // Get the title
        const titleElement = resultElement.locator('h2 a span');
        const title = await titleElement.textContent() || '';
        
        console.log(`  📋 Checking result ${i + 1}: ${title}`);

        // Verify this is the right track and is MP3/music related
        const titleLower = title.toLowerCase();
        const songMatch = titleLower.includes(item.song.toLowerCase());
        const artistMatch = titleLower.includes(item.artist.toLowerCase());
        const isMusicFormat = titleLower.includes('mp3') || 
                             titleLower.includes('music') || 
                             titleLower.includes('single') ||
                             titleLower.includes('digital');

        if ((!songMatch && !artistMatch) || !isMusicFormat) {
          continue;
        }

        // Try to get product link and navigate to product page
        const productLink = resultElement.locator('h2 a').first();
        const href = await productLink.getAttribute('href');
        
        if (!href) continue;

        const productUrl = href.startsWith('http') ? href : `https://www.amazon.com${href}`;
        console.log(`  🔗 Navigating to product page: ${productUrl}`);
        
        await this.page.goto(productUrl, { waitUntil: 'networkidle' });
        await this.page.waitForTimeout(1000);

        // Look for track price on product page
        const priceSelectors = [
          '#priceblock_dealprice',
          '#priceblock_ourprice',
          '.a-price.a-text-price.a-size-medium.apexPriceToPay .a-offscreen',
          '#tmm-grid-swatch-DOWNLOADABLE_MUSIC_TRACK .a-price .a-offscreen',
          '.a-button-selected .a-button-text .a-price .a-offscreen',
          '.a-price .a-offscreen',
        ];

        let priceFound = false;
        for (const selector of priceSelectors) {
          try {
            const priceElement = this.page.locator(selector).first();
            if (await priceElement.isVisible({ timeout: 1000 })) {
              const priceText = await priceElement.textContent() || '';
              const price = this.extractPrice(priceText);
              
              if (price > 0) {
                result.trackPrice = price;
                result.available = true;
                priceFound = true;
                console.log(`  💰 Found track price: $${price} (${selector})`);
                break;
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }

        if (priceFound) {
          // Try to find album price too
          const albumSelectors = [
            '#tmm-grid-swatch-MUSIC_ALBUM .a-price .a-offscreen',
            '[data-a-button-group="album"] .a-price .a-offscreen',
          ];

          for (const selector of albumSelectors) {
            try {
              const albumPriceElement = this.page.locator(selector).first();
              if (await albumPriceElement.isVisible({ timeout: 1000 })) {
                const albumPriceText = await albumPriceElement.textContent() || '';
                const albumPrice = this.extractPrice(albumPriceText);
                
                if (albumPrice > 0) {
                  result.albumPrice = albumPrice;
                  console.log(`  🎵 Found album price: $${albumPrice}`);
                }
              }
            } catch (e) {
              // Continue
            }
          }

          // Get album name
          try {
            const titleElement = this.page.locator('#productTitle').first();
            const albumTitle = await titleElement.textContent();
            if (albumTitle) {
              result.albumName = albumTitle.trim();
              console.log(`  📀 Album name: ${result.albumName}`);
            }
          } catch (e) {
            // Continue
          }

          break; // Found price, exit loop
        }
      }

      if (!result.available) {
        result.error = 'No MP3 price found for this track';
      }

    } catch (error) {
      result.error = `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`  ❌ Error searching for ${result.searchQuery}:`, error);
    }

    await this.page.waitForTimeout(this.delay); // Rate limiting
    return result;
  }

  async searchMultipleTracks(items: MusicItem[]): Promise<PriceInfo[]> {
    const results: PriceInfo[] = [];
    let processed = 0;

    for (const item of items) {
      processed++;
      console.log(`\n📊 Progress: ${processed}/${items.length}`);
      
      const result = await this.searchForTrack(item);
      results.push(result);
      
      // Add extra delay between requests to avoid rate limiting
      if (processed < items.length) {
        await this.page?.waitForTimeout(this.delay);
      }
    }

    return results;
  }
}