#!/usr/bin/env node

import { Command } from 'commander';
import { AmazonMusicScraper } from './scraper.js';
import { PricingAnalyzer } from './analyzer.js';
import { CsvHandler } from './csv.js';
import fs from 'fs/promises';

const program = new Command();

program
  .name('amazon-music-pricing')
  .description('Playwright-based pricing analysis for Amazon Music')
  .version('1.0.0');

program
  .command('analyze')
  .description('Analyze pricing for music tracks from CSV file')
  .requiredOption('-i, --input <file>', 'Input CSV file with music tracks')
  .option('-o, --output-json <file>', 'Output JSON report file')
  .option('-c, --output-csv <file>', 'Output CSV report file')
  .option('--headless', 'Run browser in headless mode', true)
  .option('--visible', 'Run browser in visible mode (for debugging)')
  .option('-d, --delay <ms>', 'Delay between requests in milliseconds', '3000')
  .option('-r, --retries <count>', 'Maximum retry attempts', '3')
  .action(async (options) => {
    const startTime = Date.now();
    
    console.log('🎵 Amazon Music Pricing Analysis');
    console.log('================================');
    console.log(`📂 Input file: ${options.input}`);
    console.log(`🕒 Started at: ${new Date().toLocaleString()}`);
    console.log('');

    let scraper: AmazonMusicScraper | null = null;

    try {
      // Read input CSV
      const musicItems = await CsvHandler.readMusicCsv(options.input);
      
      if (musicItems.length === 0) {
        console.error('❌ No valid music items found in CSV file');
        process.exit(1);
      }

      // Initialize scraper
      scraper = new AmazonMusicScraper({
        headless: !options.visible,
        delay: parseInt(options.delay),
        maxRetries: parseInt(options.retries)
      });

      await scraper.initialize();
      console.log('🚀 Browser initialized successfully');

      // Scrape pricing information
      console.log(`🔍 Starting price analysis for ${musicItems.length} tracks...`);
      const priceResults = await scraper.searchMultipleTracks(musicItems);

      // Analyze results
      const report = PricingAnalyzer.analyzePricing(priceResults);

      // Print summary to console
      PricingAnalyzer.printSummary(report);

      // Save JSON report if requested
      if (options.outputJson) {
        await fs.writeFile(options.outputJson, JSON.stringify(report, null, 2));
        console.log(`\n💾 JSON report saved to ${options.outputJson}`);
      }

      // Save CSV report if requested
      if (options.outputCsv) {
        await CsvHandler.writeReportCsv(report, options.outputCsv);
      }

      const duration = (Date.now() - startTime) / 1000;
      console.log(`\n⏱️  Analysis completed in ${duration.toFixed(1)} seconds`);
      console.log(`📈 Success rate: ${((report.availableTracks / report.totalTracks) * 100).toFixed(1)}%`);

    } catch (error) {
      console.error('\n❌ Analysis failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    } finally {
      if (scraper) {
        await scraper.close();
      }
    }
  });

// Handle single track pricing
program
  .command('price')
  .description('Get price for a single track')
  .requiredOption('-a, --artist <name>', 'Artist name')
  .requiredOption('-s, --song <title>', 'Song title')
  .option('-l, --album <name>', 'Album name (optional)')
  .option('--headless', 'Run browser in headless mode', true)
  .option('--visible', 'Run browser in visible mode')
  .action(async (options) => {
    let scraper: AmazonMusicScraper | null = null;

    try {
      scraper = new AmazonMusicScraper({
        headless: !options.visible,
        delay: 2000
      });

      await scraper.initialize();

      const musicItem = {
        artist: options.artist,
        song: options.song,
        album: options.album
      };

      console.log(`🔍 Searching for: ${musicItem.artist} - ${musicItem.song}`);
      const result = await scraper.searchForTrack(musicItem);

      if (result.available) {
        console.log(`\n✅ Found track: $${result.trackPrice.toFixed(2)}`);
        if (result.albumPrice && result.albumName) {
          console.log(`📀 Album "${result.albumName}": $${result.albumPrice.toFixed(2)}`);
        }
      } else {
        console.log(`\n❌ Track not available: ${result.error || 'Unknown error'}`);
      }

    } catch (error) {
      console.error('❌ Price lookup failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    } finally {
      if (scraper) {
        await scraper.close();
      }
    }
  });

program.parse();

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});