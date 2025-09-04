# Amazon Music Buyer

Hybrid Amazon Music purchasing and pricing analysis tool combining Go automation with Playwright-based price scraping.

## Architecture

- **🔧 Go Core** - Handles authentication, purchasing, and main CLI interface
- **🎭 Playwright Service** - Provides robust pricing analysis with advanced scraping
- **📊 Unified Interface** - Single command-line tool for all operations

## Features

- **🎯 Accurate Pricing Analysis** - Playwright-powered price scraping (no login required)
- **💰 Cost Optimization** - Automatically identifies when buying albums saves money  
- **🤖 Automated Purchasing** - Headless music purchasing with login automation
- **🍪 Session Management** - Cookie persistence for seamless authentication
- **📋 CSV Processing** - Batch operations and single song modes
- **📊 Detailed Reporting** - JSON and CSV export options

## Installation

### Prerequisites
- **Go 1.21+** (for purchase functionality)
- **Node.js 18+** (for pricing analysis)

### Setup

```bash
# Clone the repository
git clone https://github.com/keithah/amazon-music-buyer.git
cd amazon-music-buyer

# Build Go application
go mod tidy
go build -o amazon-music-buyer

# Install pricing service dependencies (auto-installed on first use)
cd pricing-service && npm install
```

## Configuration

### For Purchase Mode (Go)

#### Environment Variables:
```bash
export AMAZON_EMAIL="your-email@example.com"
export AMAZON_PASSWORD="your-password"
export AMAZON_COOKIE_FILE="amazon_cookies.json"  # Optional
```

#### Or Config File:
```json
{
  "email": "your-email@example.com", 
  "password": "your-password",
  "cookie_file": "amazon_cookies.json"
}
```

## Usage

### 🔍 Pricing Analysis Mode (Playwright - No Login Required)

**Basic Analysis:**
```bash
./amazon-music-buyer -price -csv sample.csv
```

**With Reports:**
```bash
./amazon-music-buyer -price -csv sample.csv -output-json report.json -output-csv report.csv
```

**Visible Browser (for debugging):**
```bash
./amazon-music-buyer -price -csv sample.csv --visible
```

**Parallel Processing Options:**
```bash
# Ultra-fast (5 concurrent workers)
./amazon-music-buyer -price -csv sample.csv --concurrency 5

# Balanced performance (3 workers - default)  
./amazon-music-buyer -price -csv sample.csv --concurrency 3

# Conservative (1 worker, essentially sequential)
./amazon-music-buyer -price -csv sample.csv --concurrency 1

# Maximum stability (true sequential processing)
./amazon-music-buyer -price -csv sample.csv --sequential
```

**The pricing analyzer will:**
- 🔍 Search Amazon Music for each track
- 💵 Extract track and album prices
- 📊 Calculate optimal purchase strategies
- 🎼 Recommend money-saving album purchases
- 📈 Generate detailed cost analysis reports

### 🛒 Purchase Mode (Go - Login Required)

#### Multiple Songs from CSV:
```bash
# Headless purchasing (default)
./amazon-music-buyer -csv sample.csv

# Visible browser (for debugging)
./amazon-music-buyer -csv sample.csv -headless=false
```

#### Single Song Purchase:
```bash
./amazon-music-buyer -song "Taylor Swift - Anti-Hero"
./amazon-music-buyer -song "Taylor Swift - Anti-Hero - Midnights"
```

### CSV Format

Create a CSV file with these columns:
```csv
artist,song,album
Taylor Swift,Anti-Hero,Midnights
The Beatles,Hey Jude,
Ed Sheeran,Shape of You,÷ (Divide)
Queen,Bohemian Rhapsody,A Night at the Opera
```

## Example Pricing Analysis Output

**Real Test Results (September 2025):**

### 🚀 **Parallel Processing (5 Workers) - RECOMMENDED**
```bash
$ ./amazon-music-buyer -price -csv sample.csv --concurrency 5

🎵 Amazon Music Pricing Analysis
================================
📂 Input file: sample.csv
🕒 Started at: 9/3/2025, 5:53:42 PM

📂 Loaded 5 tracks from sample.csv
🚀 Browser initialized successfully
🔍 Starting price analysis for 5 tracks...
⚡ Using parallel processing with 5 concurrent workers...

📦 Processing chunk 1/1 (5 tracks)
📊 [Worker 1] Starting: Taylor Swift - Anti-Hero
📊 [Worker 2] Starting: The Beatles - Hey Jude  
📊 [Worker 3] Starting: Ed Sheeran - Shape of You
📊 [Worker 4] Starting: Adele - Hello
📊 [Worker 5] Starting: Queen - Bohemian Rhapsody
✅ [Worker 1] Completed: Taylor Swift - Anti-Hero - $1.29
✅ [Worker 5] Completed: Queen - Bohemian Rhapsody - $1.29
✅ [Worker 3] Completed: Ed Sheeran - Shape of You - $0.99
✅ [Worker 2] Completed: The Beatles - Hey Jude - $1.29
✅ [Worker 4] Completed: Adele - Hello - $1.29

============================================================
🎵 AMAZON MUSIC PRICING ANALYSIS REPORT
============================================================
📅 Analysis Date: 9/3/2025, 5:53:59 PM
📊 Total Tracks: 5
✅ Available for Purchase: 5

💰 COST ANALYSIS:
  Individual Track Cost: $6.15
  Optimized Cost:        $6.15
  Total Savings:         $0.00 (0.0%)

============================================================

⏱️  Analysis completed in 17.2 seconds
📈 Success rate: 100.0%
```

### 📊 **Performance Comparison**
| Mode | Time | Per Track | Success Rate | Speedup |
|------|------|-----------|--------------|---------|
| **Parallel (5 workers)** | **17.2s** | **3.4s** | **100%** | **14.4x faster** |
| Parallel (3 workers) | 33.2s | 7s | 80% | 7.4x faster |
| Sequential (stable) | 247.0s | 49s | 100% | 1x baseline |

**✅ Perfect Results:** 14.4x performance improvement with 100% success rate maintained!

## How It Works

### 🎭 Playwright Pricing Service (pricing-service/)

1. **Advanced Scraping** - Uses stealth techniques to avoid detection
2. **Product Page Analysis** - Navigates to individual product pages for accurate pricing
3. **Smart Filtering** - Distinguishes between MP3s, books, and other products
4. **Album Detection** - Automatically finds album prices and track counts
5. **Cost Optimization** - Calculates optimal purchase strategies

### 🔧 Go Purchase Engine

1. **Session Management** - Saves/reuses cookies for authentication
2. **Headless Login** - Automated Amazon login with 2FA support
3. **Purchase Automation** - Handles search, selection, and purchase flow
4. **Error Handling** - Robust retry logic and failure recovery

### 🔗 Integration Layer

- Go CLI delegates pricing operations to Playwright service
- Automatic dependency installation and management
- Unified command-line interface for all operations
- Seamless data passing between Go and Node.js components

## Project Structure

```
amazon-music-buyer/
├── main.go                 # Go CLI and purchase engine
├── go.mod                  # Go dependencies
├── pricing-service/        # Playwright pricing service
│   ├── src/
│   │   ├── index.ts       # CLI interface
│   │   ├── scraper.ts     # Playwright scraper
│   │   ├── analyzer.ts    # Cost analysis logic
│   │   ├── csv.ts         # CSV handling
│   │   └── types.ts       # TypeScript interfaces
│   ├── package.json
│   └── tsconfig.json
├── sample.csv             # Example music list
└── README.md
```

## Branches

- **`main`** - Hybrid approach (Go + Playwright)
- **`rod`** - Original Go-only implementation with Rod browser automation

## Advanced Usage

### Direct Playwright Service

You can also use the pricing service directly:

```bash
cd pricing-service

# Analyze CSV file
npm run dev -- analyze -i ../sample.csv -o report.json -c report.csv

# Price single track  
npm run dev -- price -a "Taylor Swift" -s "Anti-Hero" --visible

# Install browser dependencies
npm run install-browsers
```

## Security Notes

⚠️ **Important Security Considerations**
- Never commit credentials to version control
- Use environment variables or secure config files
- Keep cookie files secure (they contain session tokens)
- The `.gitignore` prevents accidental credential commits

## Troubleshooting

### Pricing Analysis Issues
- Run with `--headless=false` to see browser behavior
- Check that tracks exist on Amazon Music (not just streaming services)
- Verify CSV format matches expected columns

### Purchase Authentication
- Ensure credentials are correct in config/environment
- Delete `amazon_cookies.json` to force fresh login  
- Handle 2FA by providing `AMAZON_OTP` environment variable

### Dependencies
- Go issues: `go mod tidy && go build`
- Node issues: `cd pricing-service && rm -rf node_modules && npm install`
- Browser issues: `cd pricing-service && npm run install-browsers`

## Performance

### 🚀 Parallel Processing (Default)
- **5 concurrent workers**: ~3.4 seconds per track
- **3 concurrent workers**: ~7 seconds per track  
- **14.4x faster** than sequential processing
- **100% success rate** maintained with optimal settings

### 🔄 Sequential Processing (Stable)
- **Sequential mode**: ~49 seconds per track (ultra-stable)
- **Purchase Mode**: ~2-3 seconds per track (with authentication reuse)
- Use `--sequential` flag for maximum stability

**Performance Comparison:**
```bash
# Ultra-fast parallel (recommended)
./amazon-music-buyer -price -csv sample.csv --concurrency 5

# Balanced parallel  
./amazon-music-buyer -price -csv sample.csv --concurrency 3

# Maximum stability
./amazon-music-buyer -price -csv sample.csv --sequential
```

## License

MIT License - Use responsibly and ensure compliance with Amazon's Terms of Service.

## Contributing

1. Fork the repository
2. Create feature branch from `main`
3. Test both pricing and purchase functionality
4. Submit pull request with detailed description

---

🤖 **Generated with [Claude Code](https://claude.ai/code)**