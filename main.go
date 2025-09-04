package main

import (
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
	"github.com/sirupsen/logrus"
)

type MusicItem struct {
	Artist string `csv:"artist"`
	Song   string `csv:"song"`
	Album  string `csv:"album,omitempty"`
}

type Config struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	CookieFile string `json:"cookie_file,omitempty"`
}

type AmazonMusicBuyer struct {
	browser *rod.Browser
	page    *rod.Page
	logger  *logrus.Logger
	config  Config
	headless bool
}

func NewAmazonMusicBuyer(headless bool, configFile string) (*AmazonMusicBuyer, error) {
	logger := logrus.New()
	logger.SetLevel(logrus.InfoLevel)
	
	config, err := loadConfig(configFile)
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %w", err)
	}
	
	if config.CookieFile == "" {
		config.CookieFile = "amazon_cookies.json"
	}
	
	return &AmazonMusicBuyer{
		logger: logger,
		config: config,
		headless: headless,
	}, nil
}

func loadConfig(configFile string) (Config, error) {
	var config Config
	
	// Try config file first
	if configFile != "" {
		data, err := ioutil.ReadFile(configFile)
		if err != nil {
			return config, fmt.Errorf("failed to read config file: %w", err)
		}
		if err := json.Unmarshal(data, &config); err != nil {
			return config, fmt.Errorf("failed to parse config file: %w", err)
		}
	}
	
	// Override with environment variables if set
	if email := os.Getenv("AMAZON_EMAIL"); email != "" {
		config.Email = email
	}
	if password := os.Getenv("AMAZON_PASSWORD"); password != "" {
		config.Password = password
	}
	if cookieFile := os.Getenv("AMAZON_COOKIE_FILE"); cookieFile != "" {
		config.CookieFile = cookieFile
	}
	
	if config.Email == "" || config.Password == "" {
		return config, fmt.Errorf("email and password must be provided via config file or environment variables")
	}
	
	return config, nil
}

func (amb *AmazonMusicBuyer) Initialize() error {
	l := launcher.New()
	if amb.headless {
		l = l.Headless(true).Leakless(false)
	} else {
		l = l.Headless(false)
	}
	
	// Set user agent to avoid detection
	l = l.Set("user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	
	url, err := l.Launch()
	if err != nil {
		return fmt.Errorf("failed to launch browser: %w", err)
	}

	amb.browser = rod.New().ControlURL(url)
	if err := amb.browser.Connect(); err != nil {
		return fmt.Errorf("failed to connect to browser: %w", err)
	}

	amb.page = amb.browser.MustPage()
	
	// Set viewport for consistency
	amb.page.MustSetViewport(1920, 1080, 1, false)
	
	return nil
}

func (amb *AmazonMusicBuyer) Close() {
	if amb.page != nil {
		amb.page.Close()
	}
	if amb.browser != nil {
		amb.browser.Close()
	}
}

func (amb *AmazonMusicBuyer) SaveCookies() error {
	cookies := amb.page.MustCookies()
	
	data, err := json.Marshal(cookies)
	if err != nil {
		return fmt.Errorf("failed to marshal cookies: %w", err)
	}
	
	if err := ioutil.WriteFile(amb.config.CookieFile, data, 0600); err != nil {
		return fmt.Errorf("failed to save cookies: %w", err)
	}
	
	amb.logger.Info("Cookies saved successfully")
	return nil
}

func (amb *AmazonMusicBuyer) LoadCookies() error {
	if _, err := os.Stat(amb.config.CookieFile); os.IsNotExist(err) {
		return fmt.Errorf("cookie file does not exist")
	}
	
	data, err := ioutil.ReadFile(amb.config.CookieFile)
	if err != nil {
		return fmt.Errorf("failed to read cookie file: %w", err)
	}
	
	var cookies []*proto.NetworkCookie
	if err := json.Unmarshal(data, &cookies); err != nil {
		return fmt.Errorf("failed to unmarshal cookies: %w", err)
	}
	
	// Convert NetworkCookie to NetworkCookieParam for setting
	for _, cookie := range cookies {
		amb.page.MustSetCookies(&proto.NetworkCookieParam{
			Name:     cookie.Name,
			Value:    cookie.Value,
			Domain:   cookie.Domain,
			Path:     cookie.Path,
			Expires:  cookie.Expires,
			HTTPOnly: cookie.HTTPOnly,
			Secure:   cookie.Secure,
			SameSite: cookie.SameSite,
		})
	}
	
	amb.logger.Info("Cookies loaded successfully")
	return nil
}

func (amb *AmazonMusicBuyer) Login() error {
	amb.logger.Info("Attempting to login to Amazon Music...")
	
	// First try to load existing cookies
	if err := amb.LoadCookies(); err == nil {
		amb.page.MustNavigate("https://music.amazon.com/")
		amb.page.MustWaitLoad()
		
		// Check if cookies are still valid
		if amb.isLoggedIn() {
			amb.logger.Info("Successfully logged in using saved cookies")
			return nil
		}
		amb.logger.Info("Saved cookies are expired, performing fresh login")
	}
	
	// Perform fresh login
	amb.page.MustNavigate("https://www.amazon.com/")
	amb.page.MustWaitLoad()
	
	// Click sign in button
	signInLink := amb.page.MustElement("#nav-link-accountList")
	signInLink.MustClick()
	amb.page.MustWaitLoad()
	
	// Enter email
	emailField := amb.page.MustElement("#ap_email")
	emailField.MustInput(amb.config.Email)
	
	continueBtn := amb.page.MustElement("#continue")
	continueBtn.MustClick()
	amb.page.MustWaitLoad()
	
	// Enter password
	time.Sleep(1 * time.Second) // Small delay to avoid detection
	passwordField := amb.page.MustElement("#ap_password")
	passwordField.MustInput(amb.config.Password)
	
	signInBtn := amb.page.MustElement("#signInSubmit")
	signInBtn.MustClick()
	amb.page.MustWaitLoad()
	
	// Check for CAPTCHA
	if amb.page.MustHas("#auth-captcha-image") {
		amb.logger.Error("CAPTCHA detected - manual intervention required")
		amb.logger.Info("Please solve the CAPTCHA manually in the browser window...")
		
		if amb.headless {
			return fmt.Errorf("CAPTCHA detected in headless mode - cannot proceed")
		}
		
		// Wait for user to solve CAPTCHA
		for amb.page.MustHas("#auth-captcha-image") {
			time.Sleep(2 * time.Second)
		}
	}
	
	// Check for 2FA
	if amb.page.MustHas("#auth-mfa-otpcode") {
		amb.logger.Info("2FA detected - checking for OTP code...")
		
		otpCode := os.Getenv("AMAZON_OTP")
		if otpCode == "" && amb.headless {
			return fmt.Errorf("2FA required but no OTP code provided in headless mode")
		}
		
		if otpCode != "" {
			otpField := amb.page.MustElement("#auth-mfa-otpcode")
			otpField.MustInput(otpCode)
			
			submitBtn := amb.page.MustElement("#auth-signin-button")
			submitBtn.MustClick()
		} else {
			amb.logger.Info("Please enter 2FA code manually...")
			for amb.page.MustHas("#auth-mfa-otpcode") {
				time.Sleep(2 * time.Second)
			}
		}
	}
	
	amb.page.MustWaitLoad()
	
	// Navigate to Amazon Music
	amb.page.MustNavigate("https://music.amazon.com/")
	amb.page.MustWaitLoad()
	
	if !amb.isLoggedIn() {
		return fmt.Errorf("login failed - unable to access Amazon Music")
	}
	
	// Save cookies for future use
	if err := amb.SaveCookies(); err != nil {
		amb.logger.WithError(err).Warn("Failed to save cookies")
	}
	
	amb.logger.Info("Successfully logged in to Amazon Music")
	return nil
}

func (amb *AmazonMusicBuyer) isLoggedIn() bool {
	// Check multiple indicators of being logged in
	return amb.page.MustHas("#nav-link-accountList-nav-line-1") || 
		   amb.page.MustHas("[data-testid='user-menu']") ||
		   amb.page.MustHas("#glow-ingress-line1")
}

func (amb *AmazonMusicBuyer) SearchAndBuy(item MusicItem) error {
	amb.logger.WithFields(logrus.Fields{
		"artist": item.Artist,
		"song":   item.Song,
		"album":  item.Album,
	}).Info("Searching for music item...")
	
	// Navigate to Amazon Digital Music Store
	amb.page.MustNavigate("https://www.amazon.com/music/unlimited")
	amb.page.MustWaitLoad()
	time.Sleep(2 * time.Second)
	
	// Build search query
	searchQuery := fmt.Sprintf("%s %s", item.Artist, item.Song)
	if item.Album != "" {
		searchQuery += " " + item.Album
	}
	
	// Try to find and use the search box
	searchBox := amb.page.MustElement("#twotabsearchtextbox")
	searchBox.MustClick()
	searchBox.MustSelectAllText()
	searchBox.MustInput(searchQuery)
	
	searchButton := amb.page.MustElement("#nav-search-submit-button")
	searchButton.MustClick()
	amb.page.MustWaitLoad()
	
	// Wait for search results
	time.Sleep(3 * time.Second)
	
	// Look for digital music purchase options
	// Try to find MP3 purchase buttons or links
	buySelectors := []string{
		"[aria-label*='Buy MP3']",
		"[aria-label*='Buy Song']",
		"button:has-text('Buy MP3')",
		"a:has-text('Buy MP3')",
		".a-button-buy-mp3",
	}
	
	var found bool
	for _, selector := range buySelectors {
		if amb.page.MustHas(selector) {
			element := amb.page.MustElement(selector)
			element.MustClick()
			found = true
			break
		}
	}
	
	if !found {
		amb.logger.WithField("query", searchQuery).Warn("No purchase options found")
		return fmt.Errorf("no purchase options found for: %s", searchQuery)
	}
	
	// Handle purchase confirmation
	time.Sleep(2 * time.Second)
	
	// Check for "Buy now" or confirmation button
	confirmSelectors := []string{
		"#buy-now-button",
		"[name='submit.buy-now']",
		"input[aria-labelledby*='buy-now']",
		"#a-autoid-0-announce",
	}
	
	for _, selector := range confirmSelectors {
		if amb.page.MustHas(selector) {
			element := amb.page.MustElement(selector)
			element.MustClick()
			break
		}
	}
	
	amb.logger.Info("Purchase initiated successfully")
	time.Sleep(3 * time.Second)
	
	return nil
}

func (amb *AmazonMusicBuyer) ProcessCSV(filename string) error {
	file, err := os.Open(filename)
	if err != nil {
		return fmt.Errorf("failed to open CSV file: %w", err)
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		return fmt.Errorf("failed to read CSV: %w", err)
	}

	if len(records) == 0 {
		return fmt.Errorf("CSV file is empty")
	}

	// Skip header row if it exists
	start := 0
	if records[0][0] == "artist" || records[0][0] == "Artist" {
		start = 1
	}

	successCount := 0
	failCount := 0

	for i := start; i < len(records); i++ {
		if len(records[i]) < 2 {
			amb.logger.WithField("row", i).Warn("Skipping row with insufficient data")
			continue
		}

		item := MusicItem{
			Artist: strings.TrimSpace(records[i][0]),
			Song:   strings.TrimSpace(records[i][1]),
		}
		
		if len(records[i]) > 2 {
			item.Album = strings.TrimSpace(records[i][2])
		}

		if err := amb.SearchAndBuy(item); err != nil {
			amb.logger.WithError(err).WithField("item", item).Error("Failed to process item")
			failCount++
			continue
		}
		
		successCount++
		// Add delay between purchases to avoid rate limiting
		time.Sleep(5 * time.Second)
	}

	amb.logger.WithFields(logrus.Fields{
		"success": successCount,
		"failed":  failCount,
		"total":   successCount + failCount,
	}).Info("Finished processing CSV")

	return nil
}

func parseSongString(songStr string) (MusicItem, error) {
	parts := strings.Split(songStr, " - ")
	
	if len(parts) < 2 {
		return MusicItem{}, fmt.Errorf("invalid song format. Use 'Artist - Song' or 'Artist - Song - Album'")
	}
	
	item := MusicItem{
		Artist: strings.TrimSpace(parts[0]),
		Song:   strings.TrimSpace(parts[1]),
	}
	
	if len(parts) >= 3 {
		item.Album = strings.TrimSpace(parts[2])
	}
	
	if item.Artist == "" || item.Song == "" {
		return MusicItem{}, fmt.Errorf("artist and song cannot be empty")
	}
	
	return item, nil
}

func main() {
	csvFile := flag.String("csv", "", "Path to CSV file containing music list")
	song := flag.String("song", "", "Single song to buy (format: 'Artist - Song' or 'Artist - Song - Album')")
	configFile := flag.String("config", "config.json", "Path to configuration file")
	headless := flag.Bool("headless", true, "Run browser in headless mode (default: true)")
	priceOnly := flag.Bool("price", false, "Analyze pricing only (no login required)")
	outputJSON := flag.String("output-json", "", "Save pricing report as JSON")
	outputCSV := flag.String("output-csv", "", "Save pricing report as CSV")
	flag.Parse()

	// Price analysis mode (no login required) - delegates to Playwright service
	if *priceOnly {
		if *csvFile == "" {
			fmt.Println("Error: -csv flag is required for pricing analysis")
			os.Exit(1)
		}
		
		// Build command for Playwright pricing service
		cmd := []string{"npm", "run", "dev", "--", "analyze", "-i", *csvFile}
		
		if !*headless {
			cmd = append(cmd, "--visible")
		}
		
		if *outputJSON != "" {
			cmd = append(cmd, "-o", *outputJSON)
		}
		
		if *outputCSV != "" {
			cmd = append(cmd, "-c", *outputCSV)
		}
		
		fmt.Println("Starting Playwright-based pricing analysis (no login required)...")
		
		// Check if pricing service dependencies are installed
		if _, err := os.Stat("pricing-service/node_modules"); os.IsNotExist(err) {
			fmt.Println("Installing pricing service dependencies...")
			installCmd := exec.Command("npm", "install")
			installCmd.Dir = "pricing-service"
			if err := installCmd.Run(); err != nil {
				log.Fatal("Failed to install pricing service dependencies:", err)
			}
		}
		
		// Run the pricing service
		pricingCmd := exec.Command(cmd[0], cmd[1:]...)
		pricingCmd.Dir = "pricing-service"
		pricingCmd.Stdout = os.Stdout
		pricingCmd.Stderr = os.Stderr
		
		if err := pricingCmd.Run(); err != nil {
			log.Fatal("Pricing analysis failed:", err)
		}
		
		return
	}

	// Purchase mode (login required)
	if *csvFile == "" && *song == "" {
		fmt.Println("Usage:")
		fmt.Println("")
		fmt.Println("PURCHASE MODE (requires login):")
		fmt.Println("  amazon-music-buyer -csv <path-to-csv-file>")
		fmt.Println("  amazon-music-buyer -song \"Artist - Song\"")
		fmt.Println("")
		fmt.Println("PRICING ANALYSIS MODE (no login required):")
		fmt.Println("  amazon-music-buyer -price -csv <path-to-csv-file>")
		fmt.Println("  amazon-music-buyer -price -csv <file> -output-json report.json")
		fmt.Println("  amazon-music-buyer -price -csv <file> -output-csv report.csv")
		fmt.Println("")
		fmt.Println("Options:")
		fmt.Println("  -price           Analyze pricing only (no login/purchase)")
		fmt.Println("  -config <file>   Configuration file (default: config.json)")
		fmt.Println("  -headless        Run in headless mode (default: true)")
		fmt.Println("  -output-json     Save pricing report as JSON")
		fmt.Println("  -output-csv      Save pricing report as CSV")
		fmt.Println("")
		fmt.Println("Environment Variables (for purchase mode):")
		fmt.Println("  AMAZON_EMAIL     Amazon account email")
		fmt.Println("  AMAZON_PASSWORD  Amazon account password")
		fmt.Println("  AMAZON_OTP       2FA OTP code (optional)")
		fmt.Println("")
		fmt.Println("CSV format: artist,song,album (album is optional)")
		os.Exit(1)
	}

	if *csvFile != "" && *song != "" {
		fmt.Println("Error: Cannot use both -csv and -song flags simultaneously")
		os.Exit(1)
	}

	buyer, err := NewAmazonMusicBuyer(*headless, *configFile)
	if err != nil {
		log.Fatal("Failed to create buyer:", err)
	}
	
	if err := buyer.Initialize(); err != nil {
		log.Fatal("Failed to initialize browser:", err)
	}
	defer buyer.Close()

	if err := buyer.Login(); err != nil {
		log.Fatal("Failed to login:", err)
	}

	if *song != "" {
		item, err := parseSongString(*song)
		if err != nil {
			log.Fatal("Failed to parse song string:", err)
		}
		
		if err := buyer.SearchAndBuy(item); err != nil {
			log.Fatal("Failed to buy song:", err)
		}
		
		fmt.Printf("Successfully processed song: %s by %s\n", item.Song, item.Artist)
	} else {
		if err := buyer.ProcessCSV(*csvFile); err != nil {
			log.Fatal("Failed to process CSV:", err)
		}
		
		fmt.Println("Finished processing CSV file!")
	}
}