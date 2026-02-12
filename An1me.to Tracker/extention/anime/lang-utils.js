/**
 * Language Utilities for Anime Tracker
 */

const LangUtils = {
    /**
     * Normalize text for comparison (handles diacritics)
     */
    normalizeText(text) {
        if (typeof text !== 'string') return '';
        
        return text
            .toLowerCase()
            .normalize('NFD') // Decompose accented characters
            .replace(/[\u0300-\u036f]/g, ''); // Remove diacritics
    },
    
    /**
     * String comparison with locale awareness
     */
    compare(a, b) {
        const normA = this.normalizeText(a);
        const normB = this.normalizeText(b);
        return normA.localeCompare(normB);
    },
    
    /**
     * Format date in relative terms
     */
    formatDate(date) {
        if (!date) return '';
        
        const d = new Date(date);
        const now = new Date();
        const diffMs = now - d;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        
        if (diffMinutes < 1) return 'Just now';
        if (diffMinutes === 1) return '1 minute ago';
        if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
        if (diffHours === 1) return '1 hour ago';
        if (diffHours < 24) return `${diffHours} hours ago`;
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        
        return d.toLocaleDateString('en-US', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    },
    
    /**
     * Escape text for HTML
     */
    escapeHtml(text) {
        if (typeof text !== 'string') return '';
        
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    /**
     * Get month name
     */
    getMonth(monthIndex) {
        const months = [
            'January', 'February', 'March', 'April',
            'May', 'June', 'July', 'August',
            'September', 'October', 'November', 'December'
        ];
        return months[monthIndex] || '';
    },
    
    /**
     * Format duration in human readable form
     */
    formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0m';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LangUtils;
}
