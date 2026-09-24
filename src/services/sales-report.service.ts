import { prisma } from '../config/database.js';

export interface SalesReportQuery {
  period?: '1month' | '3months' | '6months' | '1year' | 'custom';
  startDate?: string;
  endDate?: string;
}

export interface MonthSummary {
  month: string; // "2026-09"
  label: string; // "Sep 2026"
  revenue: number;
  orders: number;
  avgOrderValue: number;
  booksSold: number;
  shipping: number;
  discounts: number;
  tax: number;
  netRevenue: number;
  paymentBreakdown: Record<string, { count: number; amount: number }>;
  statusBreakdown: Record<string, number>;
}

export class SalesReportService {
  private static tableInitialized = false;

  /**
   * Defensive initialization: ensures SalesSnapshot table exists in PostgreSQL
   */
  public static async ensureTableExists(): Promise<void> {
    if (this.tableInitialized) return;
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SalesSnapshot" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "yearMonth" TEXT NOT NULL UNIQUE,
          "totalRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
          "totalOrders" INTEGER NOT NULL DEFAULT 0,
          "avgOrderValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
          "totalBooksSold" INTEGER NOT NULL DEFAULT 0,
          "totalShipping" DECIMAL(12,2) NOT NULL DEFAULT 0,
          "totalDiscounts" DECIMAL(12,2) NOT NULL DEFAULT 0,
          "totalTax" DECIMAL(12,2) NOT NULL DEFAULT 0,
          "netRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
          "paymentBreakdown" TEXT,
          "statusBreakdown" TEXT,
          "topBooks" TEXT,
          "dailyData" TEXT,
          "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "SalesSnapshot_yearMonth_idx" ON "SalesSnapshot"("yearMonth");
      `);
      this.tableInitialized = true;
    } catch (err: any) {
      // Non-fatal if DB permissions restrict DDL or table already exists
      console.warn('[SalesReportService] Table initialization note:', err?.message || err);
      this.tableInitialized = true;
    }
  }

  /**
   * Helper to format Date to YYYY-MM
   */
  private static getYearMonth(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  /**
   * Helper to format YYYY-MM to human label (e.g., "Sep 2026")
   */
  private static getMonthLabel(yearMonth: string): string {
    const [year, month] = yearMonth.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }

  /**
   * Resolves date bounds for the selected period
   */
  public static resolveDateRange(period?: string, startDateStr?: string, endDateStr?: string): { startDate: Date; endDate: Date } {
    const now = new Date();
    const endDate = endDateStr ? new Date(endDateStr) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    let startDate: Date;
    if (period === 'custom' && startDateStr) {
      startDate = new Date(startDateStr);
      startDate.setHours(0, 0, 0, 0);
    } else {
      let monthsToSubtract = 6;
      if (period === '1month') monthsToSubtract = 1;
      else if (period === '3months') monthsToSubtract = 3;
      else if (period === '6months') monthsToSubtract = 6;
      else if (period === '1year') monthsToSubtract = 12;

      // Start from the 1st of the starting month
      startDate = new Date(now.getFullYear(), now.getMonth() - (monthsToSubtract - 1), 1, 0, 0, 0, 0);
    }

    return { startDate, endDate };
  }

  /**
   * Generates or fetches monthly snapshot for a specific month
   */
  public static async getOrComputeMonthData(yearMonth: string, forceLive = false): Promise<MonthSummary> {
    await this.ensureTableExists();

    const currentYearMonth = this.getYearMonth(new Date());
    const isCurrentMonth = yearMonth === currentYearMonth;

    // For past months, check DB snapshot unless forceLive is true
    if (!isCurrentMonth && !forceLive) {
      try {
        const snapshot = await prisma.salesSnapshot.findUnique({
          where: { yearMonth },
        });

        if (snapshot) {
          return {
            month: snapshot.yearMonth,
            label: this.getMonthLabel(snapshot.yearMonth),
            revenue: Number(snapshot.totalRevenue),
            orders: snapshot.totalOrders,
            avgOrderValue: Number(snapshot.avgOrderValue),
            booksSold: snapshot.totalBooksSold,
            shipping: Number(snapshot.totalShipping),
            discounts: Number(snapshot.totalDiscounts),
            tax: Number(snapshot.totalTax),
            netRevenue: Number(snapshot.netRevenue),
            paymentBreakdown: snapshot.paymentBreakdown ? JSON.parse(snapshot.paymentBreakdown) : {},
            statusBreakdown: snapshot.statusBreakdown ? JSON.parse(snapshot.statusBreakdown) : {},
          };
        }
      } catch (err) {
        console.warn(`[SalesReportService] Error reading snapshot for ${yearMonth}, computing live:`, err);
      }
    }

    // Compute live from orders
    const [year, month] = yearMonth.split('-').map(Number);
    const startOfMonth = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startOfMonth, lte: endOfMonth },
      },
      include: {
        items: true,
      },
    });

    let totalRevenue = 0;
    let totalOrders = 0;
    let totalBooksSold = 0;
    let totalShipping = 0;
    let totalDiscounts = 0;
    let totalTax = 0;

    const paymentBreakdown: Record<string, { count: number; amount: number }> = {};
    const statusBreakdown: Record<string, number> = {};

    for (const ord of orders) {
      const st = ord.status || 'PENDING';
      statusBreakdown[st] = (statusBreakdown[st] || 0) + 1;

      const isValidSale = !['CANCELLED', 'REFUNDED'].includes(st);
      if (isValidSale) {
        const ordTotal = Number(ord.totalAmount || 0);
        const ordShip = Number(ord.shippingCharge || 0);
        const ordDisc = Number(ord.discountAmount || 0);
        const ordTax = Number(ord.taxAmount || 0);

        totalRevenue += ordTotal;
        totalOrders += 1;
        totalShipping += ordShip;
        totalDiscounts += ordDisc;
        totalTax += ordTax;

        const booksCount = ord.items.reduce((s, it) => s + (it.quantity || 0), 0);
        totalBooksSold += booksCount;

        const pm = (ord.paymentMethod || 'OTHER').toUpperCase();
        if (!paymentBreakdown[pm]) {
          paymentBreakdown[pm] = { count: 0, amount: 0 };
        }
        paymentBreakdown[pm].count += 1;
        paymentBreakdown[pm].amount += ordTotal;
      }
    }

    const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
    const netRevenue = Math.max(0, totalRevenue - totalShipping);

    const summary: MonthSummary = {
      month: yearMonth,
      label: this.getMonthLabel(yearMonth),
      revenue: Math.round(totalRevenue),
      orders: totalOrders,
      avgOrderValue,
      booksSold: totalBooksSold,
      shipping: Math.round(totalShipping),
      discounts: Math.round(totalDiscounts),
      tax: Math.round(totalTax),
      netRevenue: Math.round(netRevenue),
      paymentBreakdown,
      statusBreakdown,
    };

    // If it's a past month and we just computed it, persist to SalesSnapshot for database longevity
    if (!isCurrentMonth) {
      try {
        await prisma.salesSnapshot.upsert({
          where: { yearMonth },
          create: {
            yearMonth,
            totalRevenue,
            totalOrders,
            avgOrderValue,
            totalBooksSold,
            totalShipping,
            totalDiscounts,
            totalTax,
            netRevenue,
            paymentBreakdown: JSON.stringify(paymentBreakdown),
            statusBreakdown: JSON.stringify(statusBreakdown),
          },
          update: {
            totalRevenue,
            totalOrders,
            avgOrderValue,
            totalBooksSold,
            totalShipping,
            totalDiscounts,
            totalTax,
            netRevenue,
            paymentBreakdown: JSON.stringify(paymentBreakdown),
            statusBreakdown: JSON.stringify(statusBreakdown),
            snapshotDate: new Date(),
          },
        });
      } catch (err) {
        console.warn(`[SalesReportService] Unable to save snapshot for ${yearMonth}:`, err);
      }
    }

    return summary;
  }

  /**
   * Main report handler providing complete data for the Sales Report tab
   */
  public static async getSalesReport(params: SalesReportQuery) {
    await this.ensureTableExists();

    const { startDate, endDate } = this.resolveDateRange(params.period, params.startDate, params.endDate);

    // 1. Identify all months in range
    const months: string[] = [];
    const curr = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const endBound = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

    while (curr <= endBound) {
      months.push(this.getYearMonth(curr));
      curr.setMonth(curr.getMonth() + 1);
    }

    // 2. Fetch or compute monthly aggregates
    const monthlyPromises = months.map((ym) => this.getOrComputeMonthData(ym));
    const monthlyList = await Promise.all(monthlyPromises);

    // Sort descending by month (newest first)
    monthlyList.sort((a, b) => b.month.localeCompare(a.month));

    // 3. Compute overall period summary
    let periodRevenue = 0;
    let periodOrders = 0;
    let periodBooksSold = 0;
    let periodShipping = 0;
    let periodDiscounts = 0;
    let periodTax = 0;
    let periodNetRevenue = 0;

    const overallPaymentBreakdown: Record<string, { count: number; amount: number }> = {};
    const overallStatusBreakdown: Record<string, number> = {};

    for (const m of monthlyList) {
      periodRevenue += m.revenue;
      periodOrders += m.orders;
      periodBooksSold += m.booksSold;
      periodShipping += m.shipping;
      periodDiscounts += m.discounts;
      periodTax += m.tax;
      periodNetRevenue += m.netRevenue;

      for (const [pm, data] of Object.entries(m.paymentBreakdown)) {
        if (!overallPaymentBreakdown[pm]) {
          overallPaymentBreakdown[pm] = { count: 0, amount: 0 };
        }
        overallPaymentBreakdown[pm].count += data.count;
        overallPaymentBreakdown[pm].amount += data.amount;
      }

      for (const [st, count] of Object.entries(m.statusBreakdown)) {
        overallStatusBreakdown[st] = (overallStatusBreakdown[st] || 0) + count;
      }
    }

    const avgOrderValue = periodOrders > 0 ? Math.round(periodRevenue / periodOrders) : 0;

    // 4. Fetch daily points in range (for charts)
    const validOrders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
      select: {
        createdAt: true,
        totalAmount: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const dailyMap: Record<string, { revenue: number; orders: number }> = {};
    for (const ord of validOrders) {
      const dStr = ord.createdAt.toISOString().slice(0, 10);
      if (!dailyMap[dStr]) {
        dailyMap[dStr] = { revenue: 0, orders: 0 };
      }
      dailyMap[dStr].revenue += Number(ord.totalAmount || 0);
      dailyMap[dStr].orders += 1;
    }

    const daily = Object.entries(dailyMap).map(([date, data]) => ({
      date,
      label: new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      revenue: Math.round(data.revenue),
      orders: data.orders,
    }));

    // 5. Fetch Top Selling Books in this period
    const topOrderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          createdAt: { gte: startDate, lte: endDate },
          status: { notIn: ['CANCELLED', 'REFUNDED'] },
        },
      },
      include: {
        book: {
          select: {
            id: true,
            title: true,
            authors: { select: { name: true } },
            sku: true,
            coverUrl: true,
            price: true,
          },
        },
      },
    });

    const bookStatsMap: Record<string, { id: string; title: string; author: string; coverImage?: string; quantitySold: number; revenue: number }> = {};
    for (const item of topOrderItems) {
      const bId = item.bookId;
      const title = item.book?.title || 'Unknown Book';
      const author = item.book?.authors?.map((a) => a.name).join(', ') || 'Unknown Author';
      const coverImage = item.book?.coverUrl || undefined;
      const qty = item.quantity || 0;
      const price = Number(item.priceAtPurchase || item.book?.price || 0);

      if (!bookStatsMap[bId]) {
        bookStatsMap[bId] = { id: bId, title, author, coverImage, quantitySold: 0, revenue: 0 };
      }
      bookStatsMap[bId].quantitySold += qty;
      bookStatsMap[bId].revenue += Math.round(qty * price);
    }

    const topBooks = Object.values(bookStatsMap)
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 10);

    // 6. Fetch Top Customers in this period
    const customerOrders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
      select: {
        userId: true,
        totalAmount: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    const customerMap: Record<string, { id: string; name: string; email: string; phone?: string; orderCount: number; totalSpent: number }> = {};
    for (const ord of customerOrders) {
      const uId = ord.userId;
      const name = ord.user?.name || 'Customer';
      const email = ord.user?.email || 'N/A';
      const phone = ord.user?.phone || undefined;
      const amt = Number(ord.totalAmount || 0);

      if (!customerMap[uId]) {
        customerMap[uId] = { id: uId, name, email, phone, orderCount: 0, totalSpent: 0 };
      }
      customerMap[uId].orderCount += 1;
      customerMap[uId].totalSpent += Math.round(amt);
    }

    const topCustomers = Object.values(customerMap)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10);

    return {
      period: params.period || '6months',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      summary: {
        totalRevenue: Math.round(periodRevenue),
        totalOrders: periodOrders,
        avgOrderValue,
        totalBooksSold: periodBooksSold,
        totalShippingCollected: Math.round(periodShipping),
        totalDiscountsGiven: Math.round(periodDiscounts),
        totalTaxCollected: Math.round(periodTax),
        netRevenue: Math.round(periodNetRevenue),
      },
      monthly: monthlyList,
      daily,
      topBooks,
      topCustomers,
      paymentBreakdown: overallPaymentBreakdown,
      statusBreakdown: overallStatusBreakdown,
    };
  }

  /**
   * Generates a comprehensive CSV formatted for Tally accounting software
   */
  public static async generateTallyCSV(params: SalesReportQuery): Promise<{ filename: string; content: string }> {
    const { startDate, endDate } = this.resolveDateRange(params.period, params.startDate, params.endDate);

    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
      include: {
        address: true,
        user: {
          select: { name: true, email: true, phone: true },
        },
        items: {
          include: {
            book: {
              select: { title: true, authors: { select: { name: true } }, sku: true, isbn13: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const headers = [
      'Date',
      'Order Number',
      'Invoice Number',
      'Customer Name',
      'Customer Email',
      'Customer Phone',
      'Shipping State',
      'Items Description',
      'Total Quantity',
      'Items Subtotal (Rs.)',
      'Shipping Charge (Rs.)',
      'Discount (Rs.)',
      'Tax / GST (Rs.)',
      'Grand Total (Rs.)',
      'Payment Method',
      'Payment Status',
      'Order Status',
    ];

    const escapeCsv = (val: any): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = orders.map((ord) => {
      const dateStr = ord.createdAt.toISOString().slice(0, 10);
      const invoiceNo = ord.invoiceNumber || `TW-${ord.orderNumber}`;
      const customerName = ord.address?.fullName || ord.user?.name || 'Customer';
      const email = ord.customerEmail || ord.user?.email || '';
      const phone = ord.address?.phone || ord.user?.phone || '';
      const state = ord.address?.state || 'West Bengal';

      const itemsDesc = ord.items
        .map((it) => `${it.book?.title || 'Book'} (Qty: ${it.quantity})`)
        .join('; ');

      const totalQty = ord.items.reduce((s, it) => s + (it.quantity || 0), 0);
      const subtotal = Number(ord.subtotal || 0).toFixed(2);
      const shipping = Number(ord.shippingCharge || 0).toFixed(2);
      const discount = Number(ord.discountAmount || 0).toFixed(2);
      const tax = Number(ord.taxAmount || 0).toFixed(2);
      const total = Number(ord.totalAmount || 0).toFixed(2);

      return [
        escapeCsv(dateStr),
        escapeCsv(ord.orderNumber),
        escapeCsv(invoiceNo),
        escapeCsv(customerName),
        escapeCsv(email),
        escapeCsv(phone),
        escapeCsv(state),
        escapeCsv(itemsDesc),
        totalQty,
        subtotal,
        shipping,
        discount,
        tax,
        total,
        escapeCsv(ord.paymentMethod || 'PREPAID'),
        escapeCsv(ord.paymentStatus),
        escapeCsv(ord.status),
      ].join(',');
    });

    // Add UTF-8 Byte Order Mark (\uFEFF) for Excel & Tally compatibility
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);
    const filename = `Tally_Sales_Report_${startStr}_to_${endStr}.csv`;

    return { filename, content: csvContent };
  }

  /**
   * Quick endpoint comparing current month vs previous month
   */
  public static async getMonthlyComparison() {
    const now = new Date();
    const currYM = this.getYearMonth(now);

    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevYM = this.getYearMonth(prevDate);

    const [currentMonth, previousMonth] = await Promise.all([
      this.getOrComputeMonthData(currYM, true),
      this.getOrComputeMonthData(prevYM, false),
    ]);

    const calcGrowth = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Number((((curr - prev) / prev) * 100).toFixed(1));
    };

    return {
      current: currentMonth,
      previous: previousMonth,
      growth: {
        revenue: calcGrowth(currentMonth.revenue, previousMonth.revenue),
        orders: calcGrowth(currentMonth.orders, previousMonth.orders),
        avgOrderValue: calcGrowth(currentMonth.avgOrderValue, previousMonth.avgOrderValue),
        booksSold: calcGrowth(currentMonth.booksSold, previousMonth.booksSold),
      },
    };
  }

  /**
   * Backfill/refresh snapshots for the past N months
   */
  public static async backfillSnapshots(monthsCount = 12): Promise<{ refreshed: string[] }> {
    await this.ensureTableExists();
    const refreshed: string[] = [];
    const now = new Date();

    for (let i = 1; i <= monthsCount; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = this.getYearMonth(d);
      await this.getOrComputeMonthData(ym, true);
      refreshed.push(ym);
    }

    return { refreshed };
  }
}
