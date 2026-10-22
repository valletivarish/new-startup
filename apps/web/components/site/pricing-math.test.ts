import { describe, expect, it } from 'vitest';
import { GST_PERCENT, PRICE_PER_CALL, RECRUITER_SCREEN_COST, formatInr, monthlyTotal, recruiterTimeEstimate, withGst } from './pricing-math';

describe('pricing maths', () => {
  it('publishes ₹20 a call, 18% GST and ₹65 of recruiter time a screen', () => {
    expect([PRICE_PER_CALL, GST_PERCENT, RECRUITER_SCREEN_COST]).toEqual([20, 18, 65]);
  });
  it('totals completed calls at ₹20 each, before GST', () => {
    expect(monthlyTotal(0)).toBe(0);
    expect(monthlyTotal(100)).toBe(2000);
    expect(monthlyTotal(1000)).toBe(20000);
  });
  it('adds 18% GST, rounded to the nearest rupee', () => {
    expect(withGst(2000)).toBe(2360);
    expect(withGst(400)).toBe(472);
    expect(withGst(20)).toBe(24); // 23.6
    expect(withGst(0)).toBe(0);
  });
  it('estimates recruiter time at ₹65 a screen, to the nearest ₹50', () => {
    expect(recruiterTimeEstimate(100)).toBe(6500);
    expect(recruiterTimeEstimate(20)).toBe(1300);
    expect(recruiterTimeEstimate(10)).toBe(650);
    expect(recruiterTimeEstimate(1)).toBe(50); // 65 -> 50
  });
  it('treats bad call counts as zero and rounds part calls', () => {
    expect(monthlyTotal(-5)).toBe(0);
    expect(monthlyTotal(Number.NaN)).toBe(0);
    expect(monthlyTotal(2.6)).toBe(60);
  });
  it('formats rupees with Indian digit grouping', () => {
    expect(formatInr(0)).toBe('₹0');
    expect(formatInr(2360)).toBe('₹2,360');
    expect(formatInr(100000)).toBe('₹1,00,000');
    expect(formatInr(12345678)).toBe('₹1,23,45,678');
  });
});
