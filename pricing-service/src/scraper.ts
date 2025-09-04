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
    this.headless = options.headless ?? true; // Back to headless for performance
    this.delay = options.delay ?? 3000;
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

  async searchForTrackWithPage(item: MusicItem, page: Page): Promise<PriceInfo> {
    const result: PriceInfo = {
      ...item,
      trackPrice: 0,
      available: false,
      searchQuery: `${item.artist} ${item.song}${item.album ? ` ${item.album}` : ''}`,
    };

    try {
      // Navigate to Amazon Digital Music search - try MP3 downloads specifically
      let searchQuery = encodeURIComponent(`${result.searchQuery}`);
      let searchUrl = `https://www.amazon.com/s?k=${searchQuery}&i=digital-music&rh=n%3A163856011`;
      
      await page.goto(searchUrl, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000); // Shorter delay for parallel processing
      
      // Check if we got good results, if not try alternative approaches
      let hasGoodResults = false;
      try {
        const resultCount = await page.locator('[data-component-type="s-search-result"]').count();
        if (resultCount < 3) {
          // Try alternative search - look for MP3 purchases specifically on MP3 store
          searchQuery = encodeURIComponent(`${item.artist} ${item.song}`);
          searchUrl = `https://www.amazon.com/s?k=${searchQuery}&i=digital-music&rh=n%3A163856011`; // MP3 Downloads category
          await page.goto(searchUrl, { waitUntil: 'networkidle' });
          await page.waitForTimeout(1000);
        } else {
          hasGoodResults = true;
        }
      } catch (e) {
        // Continue with current page
      }

      // Try multiple selector patterns for search results
      const resultSelectors = [
        '[data-component-type="s-search-result"]',
        '[data-testid="result-info-container"]',
        '.s-result-item',
        '[data-cy="title-recipe"]',
        '.s-widget-container'
      ];
      
      let results: any[] = [];
      let workingSelector = '';
      
      for (const selector of resultSelectors) {
        const elements = await page.locator(selector).all();
        if (elements.length > 0) {
          results = elements;
          workingSelector = selector;
          break;
        }
      }
      
      if (results.length === 0) {
        result.error = 'No search results found with any selector pattern';
        return result;
      }

      // Check first few results for MP3 tracks
      for (let i = 0; i < Math.min(results.length, 3); i++) {
        const resultElement = results[i];
        
        // Try multiple patterns for getting the title
        const titleSelectors = [
          'h2 a span',
          'h2 span',
          'h2 a',
          '[data-cy="title-recipe"]',
          '.s-size-mini',
          '.a-size-base-plus',
          'a[href*="/dp/"] span'
        ];
        
        let title = '';
        for (const titleSelector of titleSelectors) {
          try {
            const titleElement = resultElement.locator(titleSelector).first();
            title = await titleElement.textContent({ timeout: 1000 }) || '';
            if (title.trim()) {
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        
        if (!title.trim()) {
          // Get all text content as fallback
          title = await resultElement.textContent() || '';
        }

        // Verify this is the right track and is actual music (not merchandise)
        const titleLower = title.toLowerCase();
        const songMatch = titleLower.includes(item.song.toLowerCase());
        const artistMatch = titleLower.includes(item.artist.toLowerCase());
        
        // Skip obvious non-music items
        const isMerchandise = titleLower.includes('poster') ||
                             titleLower.includes('print') ||
                             titleLower.includes('wall art') ||
                             titleLower.includes('t-shirt') ||
                             titleLower.includes('mug') ||
                             titleLower.includes('vinyl') ||
                             titleLower.includes('cd ') ||
                             titleLower.includes('dvd') ||
                             titleLower.includes('book');

        if ((!songMatch && !artistMatch) || isMerchandise) {
          continue;
        }

        // Try to get product link with multiple selector patterns
        const linkSelectors = [
          'h2 a',
          'a[href*="/dp/"]',
          'a[href*="/gp/"]',
          '.a-link-normal'
        ];
        
        let href = '';
        for (const linkSelector of linkSelectors) {
          try {
            const linkElement = resultElement.locator(linkSelector).first();
            href = await linkElement.getAttribute('href', { timeout: 2000 }) || '';
            if (href) {
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        
        if (!href) {
          continue;
        }

        const productUrl = href.startsWith('http') ? href : `https://www.amazon.com${href}`;
        
        await page.goto(productUrl, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1000);

        // Look for the three dots menu button that contains MP3 purchase options
        const menuButtonSelectors = [
          'button[aria-label*="More options"]',
          'button[aria-label*="menu"]',
          'button[data-testid*="menu"]',
          'button[title*="More"]',
          '[role="button"][aria-haspopup="menu"]',
          'button:has-text("⋯")',
          'button:has-text("...")',
          '.track-menu-button',
          '[data-testid*="track-menu"]'
        ];

        let foundMenuButton = false;
        for (const selector of menuButtonSelectors) {
          try {
            const menuElements = page.locator(selector);
            const count = await menuElements.count();
            
            if (count > 0) {
              // Look for the menu button near our target track
              for (let j = 0; j < Math.min(count, 5); j++) {
                const menuElement = menuElements.nth(j);
                if (await menuElement.isVisible({ timeout: 1000 })) {
                  await menuElement.click();
                  await page.waitForTimeout(1000);
                  
                  // Look for "Buy MP3 song" option in the opened menu
                  const buyMp3Selectors = [
                    'text="Buy MP3 song"',
                    'text="Buy MP3 album"',
                    '[data-testid*="buy-mp3"]',
                    'a:has-text("Buy MP3")',
                    'button:has-text("Buy MP3")',
                    '[aria-label*="Buy MP3"]'
                  ];
                  
                  let foundBuyOption = false;
                  for (const buySelector of buyMp3Selectors) {
                    try {
                      const buyOption = page.locator(buySelector).first();
                      if (await buyOption.isVisible({ timeout: 2000 })) {
                        await buyOption.click();
                        await page.waitForTimeout(2000);
                        foundBuyOption = true;
                        foundMenuButton = true;
                        break;
                      }
                    } catch (e) {
                      // Continue to next buy selector
                    }
                  }
                  
                  if (foundBuyOption) break;
                  
                  // Close menu if no buy option found
                  await page.keyboard.press('Escape');
                  await page.waitForTimeout(500);
                }
              }
              
              if (foundMenuButton) break;
            }
          } catch (e) {
            // Continue to next menu selector
          }
        }

        if (!foundMenuButton) {
          break; // Exit since we navigated away from search
        }

        // After clicking "Buy MP3", look for the price in the purchase modal
        const modalPriceSelectors = [
          'text*="Order total:"',
          'text*="$"',
          '[data-testid*="price"]',
          '.order-total',
          '.price',
          '.total-price',
          // From your screenshot: "Order total: $1.29"
          'text*="Order total: $"',
          // Look for the price pattern in any text element
          'text=/\\$\\d+\\.\\d{2}/',
          // General price selectors
          '.a-price .a-offscreen',
          '.a-price-whole',
          '#order-total',
          '[aria-label*="total"]'
        ];

        let priceFound = false;
        for (const selector of modalPriceSelectors) {
          try {
            const priceElement = page.locator(selector).first();
            if (await priceElement.isVisible({ timeout: 1000 })) {
              const priceText = await priceElement.textContent() || '';
              const price = this.extractPrice(priceText);
              
              if (price > 0) {
                result.trackPrice = price;
                result.available = true;
                priceFound = true;
                break;
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }

        if (priceFound) {
          return result;
        } else {
          break; // Exit the search results loop since we can't continue checking other results
        }
      }

      if (!result.available) {
        result.error = 'No MP3 price found for this track';
      }

    } catch (error) {
      result.error = `Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }

    return result;
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
      // Navigate to Amazon Digital Music search - try MP3 downloads specifically
      let searchQuery = encodeURIComponent(`${result.searchQuery}`);
      let searchUrl = `https://www.amazon.com/s?k=${searchQuery}&i=digital-music&rh=n%3A163856011`;
      
      console.log(`  🔍 Trying main digital music search first...`);
      
      await this.page.goto(searchUrl, { waitUntil: 'networkidle' });
      await this.page.waitForTimeout(this.delay);
      
      // Check if we got good results, if not try alternative approaches
      let hasGoodResults = false;
      try {
        const resultCount = await this.page.locator('[data-component-type="s-search-result"]').count();
        console.log(`  📊 Found ${resultCount} results with main search`);
        if (resultCount < 3) {
          // Try alternative search - look for MP3 purchases specifically on MP3 store
          console.log(`  🔄 Trying MP3 store search...`);
          searchQuery = encodeURIComponent(`${item.artist} ${item.song}`);
          searchUrl = `https://www.amazon.com/s?k=${searchQuery}&i=digital-music&rh=n%3A163856011`; // MP3 Downloads category
          await this.page.goto(searchUrl, { waitUntil: 'networkidle' });
          await this.page.waitForTimeout(this.delay);
        } else {
          hasGoodResults = true;
        }
      } catch (e) {
        console.log(`  ⚠️ Error checking results, continuing with current page...`);
      }

      // Debug: Take a screenshot to see what we're getting
      await this.page.screenshot({ path: `debug-search-${Date.now()}.png` });
      
      // Debug: Log the page title and URL
      console.log(`  🌐 Page URL: ${this.page.url()}`);
      console.log(`  📄 Page title: ${await this.page.title()}`);
      
      // Try multiple selector patterns for search results
      const resultSelectors = [
        '[data-component-type="s-search-result"]',
        '[data-testid="result-info-container"]',
        '.s-result-item',
        '[data-cy="title-recipe"]',
        '.s-widget-container'
      ];
      
      let results: any[] = [];
      let workingSelector = '';
      
      for (const selector of resultSelectors) {
        const elements = await this.page.locator(selector).all();
        console.log(`  🔍 Selector "${selector}": found ${elements.length} elements`);
        if (elements.length > 0) {
          results = elements;
          workingSelector = selector;
          break;
        }
      }
      
      if (results.length === 0) {
        // Debug: Get page content to see what's available
        const bodyText = await this.page.locator('body').textContent();
        console.log(`  📝 Page contains text: ${bodyText?.substring(0, 500)}...`);
        
        result.error = 'No search results found with any selector pattern';
        return result;
      }
      
      console.log(`  ✅ Using selector: ${workingSelector} (${results.length} results)`)

      // Check first few results for MP3 tracks
      for (let i = 0; i < Math.min(results.length, 5); i++) {
        const resultElement = results[i];
        
        // Try multiple patterns for getting the title
        const titleSelectors = [
          'h2 a span',
          'h2 span',
          'h2 a',
          '[data-cy="title-recipe"]',
          '.s-size-mini',
          '.a-size-base-plus',
          'a[href*="/dp/"] span'
        ];
        
        let title = '';
        for (const titleSelector of titleSelectors) {
          try {
            const titleElement = resultElement.locator(titleSelector).first();
            title = await titleElement.textContent({ timeout: 1000 }) || '';
            if (title.trim()) {
              console.log(`  📋 Found title with "${titleSelector}": ${title}`);
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        
        if (!title.trim()) {
          // Get all text content as fallback
          title = await resultElement.textContent() || '';
          console.log(`  📋 Fallback - full element text: ${title.substring(0, 100)}...`);
        }
        
        console.log(`  📋 Checking result ${i + 1}: ${title}`);

        // Verify this is the right track and is actual music (not merchandise)
        const titleLower = title.toLowerCase();
        const songMatch = titleLower.includes(item.song.toLowerCase());
        const artistMatch = titleLower.includes(item.artist.toLowerCase());
        
        // Skip obvious non-music items
        const isMerchandise = titleLower.includes('poster') ||
                             titleLower.includes('print') ||
                             titleLower.includes('wall art') ||
                             titleLower.includes('t-shirt') ||
                             titleLower.includes('mug') ||
                             titleLower.includes('vinyl') ||
                             titleLower.includes('cd ') ||
                             titleLower.includes('dvd') ||
                             titleLower.includes('book');

        if ((!songMatch && !artistMatch) || isMerchandise) {
          console.log(`  ⏭️  Skipping non-music item: ${title.substring(0, 50)}...`);
          continue;
        }

        // Try to get product link with multiple selector patterns
        const linkSelectors = [
          'h2 a',
          'a[href*="/dp/"]',
          'a[href*="/gp/"]',
          '.a-link-normal'
        ];
        
        let href = '';
        for (const linkSelector of linkSelectors) {
          try {
            const linkElement = resultElement.locator(linkSelector).first();
            href = await linkElement.getAttribute('href', { timeout: 2000 }) || '';
            if (href) {
              console.log(`  🔗 Found link with "${linkSelector}": ${href.substring(0, 50)}...`);
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        
        if (!href) {
          console.log(`  ❌ No product link found for result ${i + 1}`);
          continue;
        }

        const productUrl = href.startsWith('http') ? href : `https://www.amazon.com${href}`;
        console.log(`  🔗 Navigating to product page: ${productUrl}`);
        
        await this.page.goto(productUrl, { waitUntil: 'networkidle' });
        await this.page.waitForTimeout(1000);

        // Debug: Check product page
        console.log(`  📄 Product page title: ${await this.page.title()}`);
        await this.page.screenshot({ path: `debug-product-${Date.now()}.png` });

        // Look for the three dots menu button that contains MP3 purchase options
        console.log(`  🔍 Looking for track menu (three dots) button...`);
        
        const menuButtonSelectors = [
          'button[aria-label*="More options"]',
          'button[aria-label*="menu"]',
          'button[data-testid*="menu"]',
          'button[title*="More"]',
          '[role="button"][aria-haspopup="menu"]',
          'button:has-text("⋯")',
          'button:has-text("...")',
          '.track-menu-button',
          '[data-testid*="track-menu"]'
        ];

        let foundMenuButton = false;
        for (const selector of menuButtonSelectors) {
          try {
            const menuElements = this.page.locator(selector);
            const count = await menuElements.count();
            console.log(`  📋 Found ${count} elements with selector: ${selector}`);
            
            if (count > 0) {
              // Look for the menu button near our target track
              for (let i = 0; i < count; i++) {
                const menuElement = menuElements.nth(i);
                if (await menuElement.isVisible({ timeout: 1000 })) {
                  console.log(`  🎯 Clicking menu button ${i + 1}...`);
                  await menuElement.click();
                  await this.page.waitForTimeout(1000);
                  
                  // Look for "Buy MP3 song" option in the opened menu
                  const buyMp3Selectors = [
                    'text="Buy MP3 song"',
                    'text="Buy MP3 album"',
                    '[data-testid*="buy-mp3"]',
                    'a:has-text("Buy MP3")',
                    'button:has-text("Buy MP3")',
                    '[aria-label*="Buy MP3"]'
                  ];
                  
                  let foundBuyOption = false;
                  for (const buySelector of buyMp3Selectors) {
                    try {
                      const buyOption = this.page.locator(buySelector).first();
                      if (await buyOption.isVisible({ timeout: 2000 })) {
                        console.log(`  💰 Found "Buy MP3" option with: ${buySelector}`);
                        await buyOption.click();
                        await this.page.waitForTimeout(2000);
                        foundBuyOption = true;
                        foundMenuButton = true;
                        break;
                      }
                    } catch (e) {
                      // Continue to next buy selector
                    }
                  }
                  
                  if (foundBuyOption) break;
                  
                  // Close menu if no buy option found
                  await this.page.keyboard.press('Escape');
                  await this.page.waitForTimeout(500);
                }
              }
              
              if (foundMenuButton) break;
            }
          } catch (e) {
            // Continue to next menu selector
          }
        }

        if (!foundMenuButton) {
          console.log(`  ❌ No menu button found with MP3 purchase option`);
        }

        // After clicking "Buy MP3", look for the price in the purchase modal
        const modalPriceSelectors = [
          'text*="Order total:"',
          'text*="$"',
          '[data-testid*="price"]',
          '.order-total',
          '.price',
          '.total-price',
          // From your screenshot: "Order total: $1.29"
          'text*="Order total: $"',
          // Look for the price pattern in any text element
          'text=/\\$\\d+\\.\\d{2}/',
          // General price selectors
          '.a-price .a-offscreen',
          '.a-price-whole',
          '#order-total',
          '[aria-label*="total"]'
        ];

        let priceFound = false;
        for (const selector of modalPriceSelectors) {
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

          // Successfully found price, return immediately
          return result;
        } else {
          // No price found on this product page, but we've navigated away from search
          // Need to either go back or try different approach
          console.log(`  ❌ No price found on product page for result ${i + 1}`);
          break; // Exit the search results loop since we can't continue checking other results
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

  async searchMultipleTracks(items: MusicItem[], concurrency: number = 3): Promise<PriceInfo[]> {
    console.log(`🚀 Starting parallel processing with ${concurrency} concurrent scrapers...`);
    
    // Create multiple browser contexts for concurrent processing
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    
    try {
      // Initialize browser contexts
      for (let i = 0; i < Math.min(concurrency, items.length); i++) {
        const context = await this.browser!.newContext({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          viewport: { width: 1920, height: 1080 },
          extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9'
          }
        });

        const page = await context.newPage();
        
        // Block unnecessary resources to speed up loading
        await page.route('**/*', (route) => {
          const resourceType = route.request().resourceType();
          if (['image', 'stylesheet', 'font'].includes(resourceType)) {
            route.abort();
          } else {
            route.continue();
          }
        });

        contexts.push(context);
        pages.push(page);
      }

      // Process items in chunks with controlled concurrency
      const results: PriceInfo[] = [];
      const chunks = this.chunkArray(items, concurrency);
      
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        console.log(`\n📦 Processing chunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} tracks)`);
        
        // Process chunk concurrently
        const chunkPromises = chunk.map(async (item, index) => {
          const pageIndex = index % pages.length;
          const page = pages[pageIndex];
          
          console.log(`📊 [Worker ${pageIndex + 1}] Starting: ${item.artist} - ${item.song}`);
          
          try {
            const result = await this.searchForTrackWithPage(item, page);
            console.log(`✅ [Worker ${pageIndex + 1}] Completed: ${item.artist} - ${item.song} - $${result.trackPrice || 'N/A'}`);
            return result;
          } catch (error) {
            console.error(`❌ [Worker ${pageIndex + 1}] Failed: ${item.artist} - ${item.song}`, error);
            return {
              ...item,
              trackPrice: 0,
              available: false,
              searchQuery: `${item.artist} ${item.song}${item.album ? ` ${item.album}` : ''}`,
              error: `Parallel processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
          }
        });

        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults);
        
        // Add delay between chunks to avoid overwhelming the server
        if (chunkIndex < chunks.length - 1) {
          console.log(`⏳ Waiting ${this.delay}ms before next chunk...`);
          await new Promise(resolve => setTimeout(resolve, this.delay));
        }
      }

      console.log(`🎉 Parallel processing completed! Processed ${results.length} tracks`);
      return results;
      
    } finally {
      // Clean up all browser contexts
      for (const context of contexts) {
        try {
          await context.close();
        } catch (e) {
          console.error('Error closing browser context:', e);
        }
      }
    }
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async searchMultipleTracksSequential(items: MusicItem[]): Promise<PriceInfo[]> {
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