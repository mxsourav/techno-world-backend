export class Normalizer {
  /**
   * Trims whitespace, collapses multiple spaces, and normalizes capitalization.
   * " A P J Abdul Kalam " -> "A P J Abdul Kalam"
   * "a.p.j. abdul kalam" -> "A.P.J. Abdul Kalam"
   */
  static normalizeName(name: string | undefined): string {
    if (!name) return '';
    return name
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Generates a unique slug from a title and an identifier (like ISBN or a random string).
   */
  static generateSlug(title: string, identifier?: string): string {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    if (identifier) {
      return `${base}-${identifier.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    }
    
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    return `${base}-${randomSuffix}`;
  }

  /**
   * Helper to normalize a category tree if passed as a single string like "Fiction > Sci-Fi > Space"
   * or "Fiction/Sci-Fi/Space"
   */
  static normalizeCategoryHierarchy(category: string): string[] {
    if (!category) return [];
    if (category.includes('>')) return category.split('>').map(c => this.normalizeName(c));
    if (category.includes('/')) return category.split('/').map(c => this.normalizeName(c));
    return [this.normalizeName(category)];
  }
}
