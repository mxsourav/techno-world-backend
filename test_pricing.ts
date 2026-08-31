async function testPricing() {
  const payload = {
    items: [
      { bookId: '00000e3f-e047-40ad-988a-932e28b4b80d', quantity: 2 },
      { bookId: '00261960-d0e4-4cf0-b194-29072a79947c', quantity: 1 }
    ],
    couponCode: 'STUDENT15'
  };

  try {
    const res = await fetch('http://localhost:5000/api/v1/pricing/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log('Pricing Result:', JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

testPricing();
