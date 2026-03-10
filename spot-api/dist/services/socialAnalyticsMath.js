"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toFiniteNumber = toFiniteNumber;
exports.roundMetric = roundMetric;
exports.sumNumbers = sumNumbers;
exports.calculateRoi = calculateRoi;
exports.calculateWinRate = calculateWinRate;
exports.calculateAverageProfit = calculateAverageProfit;
exports.calculateSharpe = calculateSharpe;
exports.calculateMaxDrawdown = calculateMaxDrawdown;
exports.buildPnlHistory = buildPnlHistory;
exports.getWindowRoi = getWindowRoi;
exports.getSequentialReturns = getSequentialReturns;
function toFiniteNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'bigint') {
        return Number(value);
    }
    if (typeof value === 'string') {
        const normalized = value.replace(/,/g, '').trim();
        if (!normalized)
            return 0;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (value && typeof value === 'object' && 'toString' in value) {
        return toFiniteNumber(value.toString());
    }
    return 0;
}
function roundMetric(value, decimals = 8) {
    if (!Number.isFinite(value))
        return 0;
    return Number(value.toFixed(decimals));
}
function sumNumbers(values) {
    return values.reduce((total, value) => total + value, 0);
}
function calculateRoi(initialEquity, currentEquity) {
    if (initialEquity <= 0)
        return 0;
    return roundMetric(((currentEquity - initialEquity) / initialEquity) * 100);
}
function calculateWinRate(winningTrades, totalTrades) {
    if (totalTrades <= 0)
        return 0;
    return roundMetric((winningTrades / totalTrades) * 100);
}
function calculateAverageProfit(pnls) {
    if (pnls.length === 0)
        return 0;
    return roundMetric(sumNumbers(pnls) / pnls.length);
}
function calculateSharpe(returns) {
    if (returns.length < 2)
        return 0;
    const mean = sumNumbers(returns) / returns.length;
    const variance = sumNumbers(returns.map((value) => (value - mean) ** 2)) / returns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0)
        return 0;
    return roundMetric((mean / stdDev) * Math.sqrt(returns.length), 6);
}
function calculateMaxDrawdown(points) {
    if (points.length === 0)
        return 0;
    let peak = points[0].equity;
    let worstDrawdown = 0;
    for (const point of points) {
        if (point.equity > peak) {
            peak = point.equity;
            continue;
        }
        if (peak <= 0)
            continue;
        const drawdown = ((peak - point.equity) / peak) * 100;
        if (drawdown > worstDrawdown) {
            worstDrawdown = drawdown;
        }
    }
    return roundMetric(worstDrawdown);
}
function buildPnlHistory(points, limit = 30) {
    if (points.length === 0)
        return [];
    const recentPoints = points.slice(-limit);
    const baseline = recentPoints[0].equity > 0 ? recentPoints[0].equity : 1;
    return recentPoints.map((point) => roundMetric(((point.equity - baseline) / baseline) * 100, 4));
}
function getWindowRoi(points, days, referenceTime = Date.now()) {
    if (points.length === 0)
        return 0;
    const cutoff = referenceTime - days * 24 * 60 * 60 * 1000;
    const endPoint = points[points.length - 1];
    const previousPoint = [...points].reverse().find((point) => point.timestamp < cutoff) ?? points[0];
    return calculateRoi(previousPoint.equity, endPoint.equity);
}
function getSequentialReturns(points) {
    if (points.length < 2)
        return [];
    const returns = [];
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        if (previous.equity <= 0)
            continue;
        returns.push((current.equity - previous.equity) / previous.equity);
    }
    return returns;
}
//# sourceMappingURL=socialAnalyticsMath.js.map