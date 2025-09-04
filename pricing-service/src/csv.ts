import fs from 'fs/promises';
import csv from 'csv-parser';
import createCsvWriter from 'csv-writer';
import { Readable } from 'stream';
import { MusicItem, PricingReport } from './types.js';

export class CsvHandler {
  static async readMusicCsv(filePath: string): Promise<MusicItem[]> {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const items: MusicItem[] = [];
    
    return new Promise((resolve, reject) => {
      const stream = Readable.from([fileContent]);
      
      stream
        .pipe(csv())
        .on('data', (row) => {
          // Handle different column name formats
          const artist = row.artist || row.Artist || '';
          const song = row.song || row.Song || row.title || row.Title || '';
          const album = row.album || row.Album || '';
          
          if (artist.trim() && song.trim()) {
            items.push({
              artist: artist.trim(),
              song: song.trim(),
              album: album.trim() || undefined
            });
          }
        })
        .on('end', () => {
          console.log(`📂 Loaded ${items.length} tracks from ${filePath}`);
          resolve(items);
        })
        .on('error', (error) => {
          reject(new Error(`Failed to read CSV file: ${error.message}`));
        });
    });
  }

  static async writeReportCsv(report: PricingReport, filePath: string): Promise<void> {
    const csvWriter = createCsvWriter.createObjectCsvWriter({
      path: filePath,
      header: [
        { id: 'artist', title: 'Artist' },
        { id: 'song', title: 'Song' },
        { id: 'album', title: 'Album' },
        { id: 'trackPrice', title: 'Track Price' },
        { id: 'albumPrice', title: 'Album Price' },
        { id: 'albumName', title: 'Album Name' },
        { id: 'available', title: 'Available' },
        { id: 'recommendation', title: 'Recommendation' },
        { id: 'error', title: 'Error' }
      ]
    });

    // Prepare data with recommendations
    const data = report.tracks.map(track => {
      let recommendation = '';
      
      // Find if this track is part of an album recommendation
      for (const analysis of report.albumAnalysis) {
        if (analysis.tracks.includes(track.song) && 
            analysis.artist === track.artist && 
            analysis.savings > 0) {
          recommendation = `Buy album (save $${analysis.savings.toFixed(2)})`;
          break;
        }
      }
      
      return {
        artist: track.artist,
        song: track.song,
        album: track.album || '',
        trackPrice: track.available ? `$${track.trackPrice.toFixed(2)}` : '',
        albumPrice: track.albumPrice ? `$${track.albumPrice.toFixed(2)}` : '',
        albumName: track.albumName || '',
        available: track.available ? 'Yes' : 'No',
        recommendation,
        error: track.error || ''
      };
    });

    await csvWriter.writeRecords(data);

    // Add summary section
    const summaryWriter = createCsvWriter.createObjectCsvWriter({
      path: filePath,
      header: [{ id: 'summary', title: 'SUMMARY' }],
      append: true
    });

    const summaryData = [
      { summary: '' },
      { summary: 'SUMMARY' },
      { summary: `Total Tracks: ${report.totalTracks}` },
      { summary: `Available Tracks: ${report.availableTracks}` },
      { summary: `Total Cost (Individual): $${report.totalCost.toFixed(2)}` },
      { summary: `Optimized Cost: $${report.optimizedCost.toFixed(2)}` },
      { summary: `Total Savings: $${report.totalSavings.toFixed(2)} (${report.savingsPercentage.toFixed(1)}%)` },
    ];

    await summaryWriter.writeRecords(summaryData);

    // Add recommendations
    if (report.recommendations.length > 0) {
      const recWriter = createCsvWriter.createObjectCsvWriter({
        path: filePath,
        header: [{ id: 'recommendation', title: 'RECOMMENDATIONS' }],
        append: true
      });

      const recData = [
        { recommendation: '' },
        { recommendation: 'RECOMMENDATIONS' },
        ...report.recommendations.map(rec => ({ recommendation: rec }))
      ];

      await recWriter.writeRecords(recData);
    }

    console.log(`📊 CSV report saved to ${filePath}`);
  }
}