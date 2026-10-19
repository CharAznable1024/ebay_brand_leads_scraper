import { describe, expect, it } from 'vitest';
import { needsFeedbackEnrichment, parsePublicProfileText } from '../src/profile.js';

describe('seller profile parser', () => {
    it('parses public profile metrics and About country', () => {
        expect(parsePublicProfileText('99.8% positive feedback 142K items sold 2.3K followers Location: France')).toMatchObject({ feedback_rate: 99.8, items_sold: 142_000, follower_count: 2_300, seller_country_code: 'FR' });
    });
    it('parses detailed feedback', () => {
        const stats = parsePublicProfileText('Feedback score: 589 Positive 41,381 Neutral 62 Negative 115 Accurate description 4.8 Reasonable shipping cost 4.7 Shipping speed 4.9 Communication 4.9');
        expect(stats).toMatchObject({ feedback_score: 589, feedback_positive_12m: 41_381, feedback_neutral_12m: 62, feedback_negative_12m: 115, rating_accurate_description: 4.8, rating_shipping_cost: 4.7 });
        expect(needsFeedbackEnrichment(stats)).toBe(false);
    });
    it('requests Feedback only when core feedback counts are missing', () => {
        const stats = parsePublicProfileText('99.8% positive feedback 142K items sold Location: France');
        expect(needsFeedbackEnrichment(stats)).toBe(true);
    });
});
