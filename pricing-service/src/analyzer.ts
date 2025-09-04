import { PriceInfo, AlbumAnalysis, PricingReport } from './types.js';

export class PricingAnalyzer {
  static analyzePricing(tracks: PriceInfo[]): PricingReport {
    const timestamp = new Date().toISOString();
    const availableTracks = tracks.filter(t => t.available);
    
    // Group tracks by album and artist
    const albumMap = new Map<string, PriceInfo[]>();
    const artistMap = new Map<string, PriceInfo[]>();
    
    for (const track of availableTracks) {
      // Group by artist
      if (!artistMap.has(track.artist)) {
        artistMap.set(track.artist, []);
      }
      artistMap.get(track.artist)!.push(track);
      
      // Group by album if we have album info
      if (track.albumName && track.albumPrice && track.albumPrice > 0) {
        const albumKey = `${track.artist}|||${track.albumName}`;
        if (!albumMap.has(albumKey)) {
          albumMap.set(albumKey, []);
        }
        albumMap.get(albumKey)!.push(track);
      }
    }

    // Analyze albums for potential savings
    const albumAnalyses: AlbumAnalysis[] = [];
    const albumsSavingMoney = new Set<string>();

    for (const [albumKey, albumTracks] of albumMap.entries()) {
      if (albumTracks.length < 3) continue; // Need at least 3 tracks to consider album purchase

      const [artist, albumName] = albumKey.split('|||');
      const albumPrice = albumTracks[0].albumPrice!;
      const totalTrackPrice = albumTracks.reduce((sum, track) => sum + track.trackPrice, 0);
      const savings = totalTrackPrice - albumPrice;

      const analysis: AlbumAnalysis = {
        albumName,
        artist,
        albumPrice,
        tracks: albumTracks.map(t => t.song),
        trackCount: albumTracks.length,
        totalTrackPrice,
        savings,
        recommendation: savings > 0 
          ? `Buy album "${albumName}" for $${albumPrice.toFixed(2)} instead of ${albumTracks.length} tracks for $${totalTrackPrice.toFixed(2)} (save $${savings.toFixed(2)})`
          : 'Buy individual tracks'
      };

      albumAnalyses.push(analysis);
      
      if (savings > 0) {
        albumsSavingMoney.add(albumKey);
      }
    }

    // Generate additional recommendations
    const recommendations: string[] = [];
    
    // Check for artists with many tracks (potential greatest hits/compilation)
    for (const [artist, artistTracks] of artistMap.entries()) {
      if (artistTracks.length >= 10) {
        const totalCost = artistTracks.reduce((sum, track) => sum + track.trackPrice, 0);
        recommendations.push(
          `Consider searching for '${artist}' greatest hits or compilation album (${artistTracks.length} tracks = $${totalCost.toFixed(2)})`
        );
      }
    }

    // Add album-specific recommendations
    albumAnalyses
      .filter(a => a.savings > 0)
      .forEach(a => recommendations.push(a.recommendation));

    // Calculate costs
    const totalCost = availableTracks.reduce((sum, track) => sum + track.trackPrice, 0);
    
    // Calculate optimized cost (use album prices where beneficial)
    let optimizedCost = 0;
    const tracksAccountedFor = new Set<string>();

    // First, account for albums where buying the album saves money
    for (const analysis of albumAnalyses) {
      if (analysis.savings > 0) {
        optimizedCost += analysis.albumPrice;
        // Mark these tracks as accounted for
        const albumKey = `${analysis.artist}|||${analysis.albumName}`;
        const albumTracks = albumMap.get(albumKey) || [];
        albumTracks.forEach(track => {
          const trackKey = `${track.artist}|||${track.song}`;
          tracksAccountedFor.add(trackKey);
        });
      }
    }

    // Add individual track prices for tracks not in money-saving albums
    for (const track of availableTracks) {
      const trackKey = `${track.artist}|||${track.song}`;
      if (!tracksAccountedFor.has(trackKey)) {
        optimizedCost += track.trackPrice;
      }
    }

    const totalSavings = totalCost - optimizedCost;
    const savingsPercentage = totalCost > 0 ? (totalSavings / totalCost) * 100 : 0;

    return {
      timestamp,
      totalTracks: tracks.length,
      availableTracks: availableTracks.length,
      totalCost,
      optimizedCost,
      totalSavings,
      savingsPercentage,
      tracks,
      albumAnalysis: albumAnalyses,
      recommendations
    };
  }

  static printSummary(report: PricingReport): void {
    console.log('\n' + '='.repeat(60));
    console.log('🎵 AMAZON MUSIC PRICING ANALYSIS REPORT');
    console.log('='.repeat(60));
    
    console.log(`📅 Analysis Date: ${new Date(report.timestamp).toLocaleString()}`);
    console.log(`📊 Total Tracks: ${report.totalTracks}`);
    console.log(`✅ Available for Purchase: ${report.availableTracks}`);
    console.log('');
    
    console.log('💰 COST ANALYSIS:');
    console.log(`  Individual Track Cost: $${report.totalCost.toFixed(2)}`);
    console.log(`  Optimized Cost:        $${report.optimizedCost.toFixed(2)}`);
    console.log(`  Total Savings:         $${report.totalSavings.toFixed(2)} (${report.savingsPercentage.toFixed(1)}%)`);
    
    if (report.albumAnalysis.length > 0) {
      console.log('\n🎼 ALBUM RECOMMENDATIONS:');
      report.albumAnalysis
        .filter(album => album.savings > 0)
        .forEach(album => {
          console.log(`  • ${album.artist} - ${album.albumName}`);
          console.log(`    ${album.trackCount} tracks: $${album.albumPrice.toFixed(2)} (album) vs $${album.totalTrackPrice.toFixed(2)} (individual)`);
          console.log(`    💵 Savings: $${album.savings.toFixed(2)}`);
        });
    }
    
    if (report.recommendations.length > 0) {
      console.log('\n💡 ADDITIONAL RECOMMENDATIONS:');
      report.recommendations.forEach(rec => {
        console.log(`  • ${rec}`);
      });
    }

    // Show unavailable tracks
    const unavailableTracks = report.tracks.filter(t => !t.available);
    if (unavailableTracks.length > 0) {
      console.log('\n❌ UNAVAILABLE TRACKS:');
      unavailableTracks.forEach(track => {
        console.log(`  • ${track.artist} - ${track.song}${track.error ? ` (${track.error})` : ''}`);
      });
    }
    
    console.log('\n' + '='.repeat(60));
  }
}