const assert = require('node:assert/strict');
const { test } = require('node:test');
const invoice = require('../lib/invoice');
const orders = require('../lib/orders');
const pricing = require('../lib/pricing');

function line(id, name, price, hsn) {
  return { id, name, price, hsn, qty: 1 };
}

function bill(items, coupon = '') {
  const db = { nextOrderId: 1, orders: [] };
  const billed = pricing.computeTotals(items, coupon);
  const order = orders.add(db, { items, coupon, date: '2021-11-15', ...billed });
  return { billed, order };
}

test('printed invoice shows the billed total and post-discount GST by line', () => {
  const { order } = bill([
    line(1, 'Rice', 2000, '1006'),
    line(2, 'Ghee', 1000, '0405')
  ], 'SAVE10');
  const figures = invoice.computeInvoiceFigures(order);
  assert.equal(figures.total, 3059);
  assert.equal(figures.discount, 150);
  assert.deepEqual([figures.tax, figures.cgst, figures.sgst], [209, 104.5, 104.5]);
  assert.deepEqual(figures.rows.map(({ gstPercent, lineTax }) =>
    [gstPercent, lineTax]), [[5, 95], [12, 114]]);

  const html = invoice.render(order);
  assert.match(html, /CGST \+ SGST \(Total GST\)<\/td><td class="r">₹209\.00/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹3059\.00/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});

test('invoice and billed totals agree for an undiscounted line using default GST', () => {
  const { order } = bill([line(1, 'Tea', 100, '0902')]);
  assert.deepEqual([order.subtotal, order.tax, order.total], [100, 18, 118]);
  assert.deepEqual(invoice.computeInvoiceFigures(order), {
    subtotal: 100,
    discount: 0,
    tax: 18,
    cgst: 9,
    sgst: 9,
    total: 118,
    rows: [{
      name: 'Tea', sku: '-', hsn: '0902', qty: 1, price: 100,
      gstPercent: 18, line: 100, lineTax: 18
    }]
  });
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});

test('invoice preserves the recorded amounts on an older order', () => {
  const order = {
    items: [line(1, 'Rice', 100, '1006')],
    subtotal: 100,
    discount: 0,
    tax: 18,
    total: 118
  };
  const figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual([figures.subtotal, figures.discount, figures.tax, figures.total],
    [100, 0, 18, 118]);
  assert.deepEqual([figures.cgst, figures.sgst], [9, 9]);
});

test('invoice uses the reduced taxable value after a flat coupon', () => {
  const { order } = bill([line(1, 'Tea', 300, '0902')], 'FLAT50');
  const figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual([order.discount, order.tax, order.total], [50, 45, 295]);
  assert.deepEqual([figures.discount, figures.tax, figures.total], [50, 45, 295]);
});

test('invoice supports zero and decimal GST rates on stored items', () => {
  const items = [
    { ...line(1, 'Zero-rated item', 100), gstRate: 0 },
    { ...line(2, 'Rice', 100, '1006'), gstRate: 0.05 }
  ];
  const { billed, order } = bill(items);
  const figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual(billed.lines.map(({ tax }) => tax), [0, 5]);
  assert.deepEqual(figures.rows.map(({ gstPercent, lineTax }) =>
    [gstPercent, lineTax]), [[0, 0], [5, 5]]);
  assert.equal(order.total, 205);
  assert.equal(figures.total, 205);
});

test('invoice sums GST rounded on each line', () => {
  const { billed, order } = bill([
    line(1, 'Tea sample', 0.03, '0902'),
    line(2, 'Coffee sample', 0.03, '0901')
  ]);
  const figures = invoice.computeInvoiceFigures(order);
  assert.deepEqual(figures.rows.map(({ lineTax }) => lineTax), [0.01, 0.01]);
  assert.deepEqual([order.tax, billed.cgst, billed.sgst, order.total], [0.02, 0.01, 0.01, 0.08]);
  assert.deepEqual([figures.tax, figures.cgst, figures.sgst, figures.total], [0.02, 0.01, 0.01, 0.08]);
  assert.doesNotMatch(invoice.render(order), /Accountant Reconciliation Notice/);
});
