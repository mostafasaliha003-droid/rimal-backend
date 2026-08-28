app.get('/api/bookings/pdf/:reference', async (req, res) => {
    try {
        const booking = await Booking.findOne({ bookingReference: req.params.reference });
        if(!booking) return res.status(404).send('Booking not found');

        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Rimal-Voucher-${booking.bookingReference}.pdf`);
        doc.pipe(res);

        // Header
        doc.fillColor('#1f3a40').fontSize(20).font('Helvetica-Bold').text('RIMAL INTERNATIONAL | شركة الرمال الدولية', { align: 'center' });
        doc.fontSize(10).fillColor('#ff595e').text('Laugh, Book, & Escape! - احجز، فلّها، وانحاش! ✈️', { align: 'center' });
        doc.moveDown(1.5);

        // Booking ID Box
        doc.rect(40, 100, 515, 45).fillAndStroke('#f7fff7', '#00b4d8');
        doc.fillColor('#1f3a40').fontSize(13).font('Helvetica-Bold').text(`Booking ID / Reference: ${booking.bookingReference}`, 50, 115);
        doc.fontSize(11).fillColor('#0077b6').text('Status: CONFIRMED ✅', 380, 116);
        doc.moveDown(2.5);

        // Details Section
        doc.fontSize(12).fillColor('#1f3a40').font('Helvetica-Bold').text('Reservation & Property Details:');
        doc.moveDown(0.5);

        const details = [
            ['Guest Name:', booking.customerName],
            ['Property / Hotel:', booking.hotelName],
            ['Email Address:', booking.email],
            ['Phone Number:', booking.phone || 'N/A'],
            ['Companions:', booking.companions || 'None'],
            ['Payment Method:', booking.paymentMethod === 'visa' ? 'Credit Card (Visa)' : 'Pay at Hotel'],
            ['Total Amount:', `${booking.price} AED`],
            ['Cancellation Policy:', booking.cancellationPolicy]
        ];

        let startY = doc.y;
        details.forEach(item => {
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#1f3a40').text(item[0], 50, startY, { width: 160 });
            doc.font('Helvetica').fillColor('#333333').text(item[1], 220, startY, { width: 320 });
            startY += 20;
        });

        doc.y = startY + 10;
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
        doc.moveDown(1.5);

        // Important Notes
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#ff595e').text('⚠️ Important Notes & Hotel Rules:');
        doc.moveDown(0.5);
        doc.fontSize(9).fillColor('#555555').text('• Please present either an electronic or paper copy of your booking confirmation upon check-in.');
        doc.text('• Make sure your name matches your official passport.');
        doc.text('• Fun Note: No spicy chips allowed in rooms! Have a wonderful trip with Rimal International. 😂');

        doc.moveDown(2);
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#1f3a40').text('Authorized Stamp & Signature', { align: 'left' });

        doc.end();
    } catch (e) { 
        res.status(500).send('Error generating PDF'); 
    }
});
