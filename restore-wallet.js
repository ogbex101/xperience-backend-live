// backend/restore-wallet.js
const fs = require('fs');
const path = require('path');

// This is your ORIGINAL wallet.js content from earlier
const originalWalletContent = `const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// Helper function to verify transaction PIN
const verifyTransactionPin = async (userId, pin) => {
  const { rows: user } = await db.query(
    'SELECT transaction_pin FROM users WHERE id = $1',
    [userId]
  );
  
  if (!user[0] || !user[0].transaction_pin) {
    return { valid: false, message: 'Transaction PIN not set' };
  }
  
  // Compare hashed PIN (you should hash the input pin first)
  const inputPinHash = crypto.createHash('sha256').update(pin).digest('hex');
  // In production, use bcrypt: await bcrypt.compare(pin, user[0].transaction_pin);
  
  return {
    valid: inputPinHash === user[0].transaction_pin,
    message: inputPinHash === user[0].transaction_pin ? 'PIN valid' : 'Invalid PIN'
  };
};

// Add these routes to your wallet.js:

// Get available currencies
router.get('/currencies', authenticateToken, async (req, res) => {
  try {
    const currencies = [
      { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', rate: 1 },
      { code: 'USD', name: 'US Dollar', symbol: '$', rate: 0.0012 },
      { code: 'EUR', name: 'Euro', symbol: '€', rate: 0.0011 },
      { code: 'GBP', name: 'British Pound', symbol: '£', rate: 0.0009 }
    ];
    
    res.json({
      success: true,
      currencies,
      default_currency: 'NGN'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching currencies' });
  }
});

// Set user currency preference
router.post('/set-currency', authenticateToken, async (req, res) => {
  try {
    const { currency } = req.body;
    const userId = req.user.id;
    
    const validCurrencies = ['NGN', 'USD', 'EUR', 'GBP'];
    if (!validCurrencies.includes(currency)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid currency code' 
      });
    }
    
    await db.query(
      'UPDATE users SET currency = $1 WHERE id = $2',
      [currency, userId]
    );
    
    res.json({
      success: true,
      message: 'Currency updated to ${currency}'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating currency' });
  }
});

// Get wallet balance and XP points
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const { rows: user } = await db.query(
      'SELECT balance, xp_points, wallet_account_number, currency FROM users WHERE id = $1',
      [userId]
    );
    
    if (user.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Get XP rate
    const { rows: xpRate } = await db.query(
      'SELECT xp_per_unit, unit_amount FROM xp_rates WHERE currency = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 1',
      [user[0].currency || 'NGN']
    );
    
    res.json({
      success: true,
      balance: parseFloat(user[0].balance) || 0,
      xp_points: parseInt(user[0].xp_points) || 0,
      wallet_account_number: user[0].wallet_account_number,
      currency: user[0].currency,
      xp_rate: xpRate[0] || { xp_per_unit: 25, unit_amount: 1000 }
    });
    
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    res.status(500).json({ success: false, message: 'Error fetching wallet balance' });
  }
});

// Get transaction history
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, limit = 50, offset = 0 } = req.query;
    
    let query = '
      SELECT * FROM transactions 
      WHERE user_id = $1 
    ';
    const params = [userId];
    let paramIndex = 2;
    
    if (type) {
      query += ' AND type = $${paramIndex}';
      params.push(type);
      paramIndex++;
    }
    
    query += ' ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}';
    params.push(parseInt(limit), parseInt(offset));
    
    const { rows: transactions } = await db.query(query, params);
    
    // Get XP transactions too
    const { rows: xpTransactions } = await db.query(
      'SELECT * FROM xp_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    
    res.json({
      success: true,
      transactions,
      xp_transactions: xpTransactions
    });
    
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ success: false, message: 'Error fetching transaction history' });
  }
});

// Get XP transaction history
router.get('/xp-transactions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, limit = 50, offset = 0 } = req.query;
    
    let query = '
      SELECT xt.*, 
        u1.username AS sender_username,
        u2.username AS receiver_username
      FROM xp_transactions xt
      LEFT JOIN users u1 ON xt.sender_id = u1.id
      LEFT JOIN users u2 ON xt.receiver_id = u2.id
      WHERE xt.user_id = $1
    ';
    const params = [userId];
    let paramIndex = 2;
    
    if (type) {
      query += ' AND xt.type = $${paramIndex}';
      params.push(type);
      paramIndex++;
    }
    
    query += ' ORDER BY xt.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}';
    params.push(parseInt(limit), parseInt(offset));
    
    const { rows: transactions } = await db.query(query, params);
    
    res.json({
      success: true,
      transactions
    });
    
  } catch (error) {
    console.error('Error fetching XP transactions:', error);
    res.status(500).json({ success: false, message: 'Error fetching XP transaction history' });
  }
});

// Initialize Flutterwave payment
router.post('/fund/initialize', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = 'NGN' } = req.body;
    const userId = req.user.id;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }
    
    // Generate transaction reference
    const reference = 'XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}';
    
    // Create pending transaction
    const { rows: result } = await db.query(
      'INSERT INTO transactions 
       (user_id, amount, currency, type, status, reference, description) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [userId, amount, currency, 'deposit', 'pending', reference, 'Wallet deposit via Flutterwave']
    );
    
    // Get user details for Flutterwave
    const { rows: user } = await db.query(
      'SELECT email, username FROM users WHERE id = $1',
      [userId]
    );
    
    const flutterwaveConfig = {
      public_key: process.env.FLUTTERWAVE_PUBLIC_KEY || 'FLWPUBK_TEST-xxxxxxxxxxxxxxxxxxxxxxxxxxxx-X',
      tx_ref: reference,
      amount: amount,
      currency: currency,
      redirect_url: '${process.env.CLIENT_URL}/wallet/callback',
      customer: {
        email: user[0].email,
        name: user[0].username,
      },
      customizations: {
        title: "XP Gaming Wallet",
        description: 'Deposit of ${amount} ${currency}',
        logo: "https://your-logo-url.com/logo.png"
      }
    };
    
    res.json({
      success: true,
      transaction_id: result[0].id,
      reference,
      flutterwave_config: flutterwaveConfig
    });
    
  } catch (error) {
    console.error('Error initializing payment:', error);
    res.status(500).json({ success: false, message: 'Error initializing payment' });
  }
});

// Flutterwave webhook/callback
router.post('/fund/webhook', async (req, res) => {
  try {
    const secretHash = process.env.FLW_SECRET_HASH;
    const signature = req.headers['verif-hash'];
    
    if (!signature || signature !== secretHash) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const payload = req.body;
    const { tx_ref, status, transaction_id: flw_transaction_id } = payload.data;
    
    // Find transaction
    const { rows: transactions } = await db.query(
      'SELECT * FROM transactions WHERE reference = $1',
      [tx_ref]
    );
    
    if (transactions.length === 0) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }
    
    const transaction = transactions[0];
    let newStatus = 'pending';
    
    if (status === 'successful') {
      newStatus = 'completed';
      
      // Update user balance
      await db.query(
        'UPDATE users SET balance = balance + $1 WHERE id = $2',
        [parseFloat(transaction.amount), transaction.user_id]
      );
    } else if (status === 'failed') {
      newStatus = 'failed';
    }
    
    // Update transaction
    await db.query(
      'UPDATE transactions 
       SET status = $1, external_reference = $2, completed_at = NOW() 
       WHERE id = $3',
      [newStatus, flw_transaction_id || null, transaction.id]
    );
    
    res.json({ success: true, message: 'Webhook processed' });
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ success: false, message: 'Error processing webhook' });
  }
});

// Transfer funds to another user
router.post('/transfer/funds', authenticateToken, async (req, res) => {
  try {
    const { recipient_account, amount, pin, description } = req.body;
    const senderId = req.user.id;
    
    if (!recipient_account || !amount || !pin) {
      return res.status(400).json({ 
        success: false, 
        message: 'Recipient account, amount, and PIN are required' 
      });
    }
    
    if (amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Amount must be greater than 0' 
      });
    }
    
    // Verify transaction PIN
    const pinVerification = await verifyTransactionPin(senderId, pin);
    if (!pinVerification.valid) {
      return res.status(401).json({ 
        success: false, 
        message: pinVerification.message 
      });
    }
    
    // Check sender balance
    const { rows: sender } = await db.query(
      'SELECT balance, currency, wallet_account_number FROM users WHERE id = $1',
      [senderId]
    );
    
    if (parseFloat(sender[0].balance) < parseFloat(amount)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient balance' 
      });
    }
    
    // Find recipient
    const { rows: recipient } = await db.query(
      'SELECT id, username FROM users WHERE wallet_account_number = $1',
      [recipient_account]
    );
    
    if (recipient.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Recipient not found' 
      });
    }
    
    if (recipient[0].id === senderId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot transfer to yourself' 
      });
    }
    
    // Use PostgreSQL transaction
    await db.query('BEGIN');
    
    try {
      // Deduct from sender
      await db.query(
        'UPDATE users SET balance = balance - $1 WHERE id = $2',
        [amount, senderId]
      );
      
      // Add to recipient
      await db.query(
        'UPDATE users SET balance = balance + $1 WHERE id = $2',
        [amount, recipient[0].id]
      );
      
      // Create sender transaction
      const senderReference = 'XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}';
      await db.query(
        'INSERT INTO transactions (user_id, amount, currency, type, status, reference, description, external_reference) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          senderId, 
          -amount, 
          sender[0].currency, 
          'transfer', 
          'completed', 
          senderReference,
          description || 'Fund transfer to ${recipient[0].username}',
          JSON.stringify({
            recipient_id: recipient[0].id,
            recipient_name: recipient[0].username,
            recipient_account: recipient_account
          })
        ]
      );
      
      // Create recipient transaction
      const recipientReference = 'XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}';
      await db.query(
        'INSERT INTO transactions (user_id, amount, currency, type, status, reference, description, external_reference) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          recipient[0].id, 
          amount, 
          sender[0].currency, 
          'deposit', 
          'completed', 
          recipientReference,
          description || 'Fund transfer from ${req.user.username}',
          JSON.stringify({
            sender_id: senderId,
            sender_name: req.user.username,
            sender_account: sender[0].wallet_account_number
          })
        ]
      );
      
      await db.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Transfer successful',
        amount,
        recipient: recipient[0].username
      });
      
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('Error transferring funds:', error);
    res.status(500).json({ success: false, message: 'Error transferring funds' });
  }
});

// Convert money to XP points
router.post('/convert/to-xp', authenticateToken, async (req, res) => {
  try {
    const { amount, pin } = req.body;
    const userId = req.user.id;
    
    console.log('=== CONVERT TO XP DEBUG ===');
    console.log('User ID:', userId);
    console.log('Amount:', amount);
    console.log('PIN provided:', pin ? 'Yes' : 'No');
    
    if (!amount || !pin) {
      console.log('ERROR: Missing amount or PIN');
      return res.status(400).json({ 
        success: false, 
        message: 'Amount and PIN are required' 
      });
    }
    
    // Verify transaction PIN
    const pinVerification = await verifyTransactionPin(userId, pin);
    if (!pinVerification.valid) {
      console.log('ERROR: Invalid PIN');
      return res.status(401).json({ 
        success: false, 
        message: pinVerification.message 
      });
    }
    
    // Get user balance and currency
    const { rows: user } = await db.query(
      'SELECT balance, currency, xp_points FROM users WHERE id = $1',
      [userId]
    );
    
    console.log('User currency:', user[0].currency);
    console.log('User balance:', user[0].balance);
    console.log('Current XP points:', user[0].xp_points);
    
    if (parseFloat(user[0].balance) < parseFloat(amount)) {
      console.log('ERROR: Insufficient balance');
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient balance' 
      });
    }
    
    // Get XP rate
    const { rows: xpRate } = await db.query(
      'SELECT xp_per_unit, unit_amount FROM xp_rates WHERE currency = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 1',
      [user[0].currency || 'NGN']
    );
    
    console.log('XP Rate query result:', xpRate);
    
    if (!xpRate[0]) {
      console.log('ERROR: No XP rate found for currency:', user[0].currency);
      return res.status(400).json({ 
        success: false, 
        message: 'XP conversion rate not available' 
      });
    }
    
    console.log('XP Rate found:', xpRate[0]);
    
    // Calculate XP points (25 XP per 1000 Naira)
    const xpPoints = Math.floor((parseFloat(amount) / parseFloat(xpRate[0].unit_amount)) * parseFloat(xpRate[0].xp_per_unit));
    
    // Use PostgreSQL transaction
    await db.query('BEGIN');
    
    try {
      // Deduct money
      await db.query(
        'UPDATE users SET balance = balance - $1 WHERE id = $2',
        [amount, userId]
      );
      
      // Add XP points - Use COALESCE to handle null xp_points
      await db.query(
        'UPDATE users SET xp_points = COALESCE(xp_points, 0) + $1 WHERE id = $2',
        [xpPoints, userId]
      );
      
      // Create money transaction
      const reference = 'XP-CONV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}';
      const { rows: txResult } = await db.query(
        'INSERT INTO transactions 
         (user_id, amount, currency, type, status, reference, description) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [
          userId, 
          -amount, 
          user[0].currency, 
          'withdrawal', 
          'completed', 
          reference,
          'Converted to ${xpPoints} XP points'
        ]
      );
      
      // Create XP transaction
      await db.query(
        'INSERT INTO xp_transactions 
         (user_id, type, amount, related_transaction_id, description) 
         VALUES ($1, $2, $3, $4, $5)',
        [
          userId,
          'converted_from_money',
          xpPoints,
          txResult[0].id,
          'Converted from ${amount} ${user[0].currency}'
        ]
      );
      
      await db.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Conversion successful',
        amount,
        xp_points: xpPoints,
        new_balance: parseFloat(user[0].balance) - parseFloat(amount),
        new_xp_points: (parseInt(user[0].xp_points) || 0) + xpPoints
      });
      
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('Error converting to XP:', error);
    res.status(500).json({ success: false, message: 'Error converting to XP' });
  }
});

// Transfer XP points to another user
router.post('/transfer/xp', authenticateToken, async (req, res) => {
  try {
    const { recipient_account, xp_points, pin, description } = req.body;
    const senderId = req.user.id;
    
    if (!recipient_account || !xp_points || !pin) {
      return res.status(400).json({ 
        success: false, 
        message: 'Recipient account, XP points, and PIN are required' 
      });
    }
    
    if (xp_points <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'XP points must be greater than 0' 
      });
    }
    
    // Verify transaction PIN
    const pinVerification = await verifyTransactionPin(senderId, pin);
    if (!pinVerification.valid) {
      return res.status(401).json({ 
        success: false, 
        message: pinVerification.message 
      });
    }
    
    // Check sender XP balance
    const { rows: sender } = await db.query(
      'SELECT xp_points, username FROM users WHERE id = $1',
      [senderId]
    );
    
    if ((parseInt(sender[0].xp_points) || 0) < parseInt(xp_points)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient XP points' 
      });
    }
    
    // Find recipient
    const { rows: recipient } = await db.query(
      'SELECT id, username FROM users WHERE wallet_account_number = $1',
      [recipient_account]
    );
    
    if (recipient.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Recipient not found' 
      });
    }
    
    if (recipient[0].id === senderId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot transfer to yourself' 
      });
    }
    
    // Use PostgreSQL transaction
    await db.query('BEGIN');
    
    try {
      // Deduct from sender - Use COALESCE to handle null xp_points
      await db.query(
        'UPDATE users SET xp_points = COALESCE(xp_points, 0) - $1 WHERE id = $2',
        [xp_points, senderId]
      );
      
      // Add to recipient - Use COALESCE to handle null xp_points
      await db.query(
        'UPDATE users SET xp_points = COALESCE(xp_points, 0) + $1 WHERE id = $2',
        [xp_points, recipient[0].id]
      );
      
      // Create sender XP transaction
      await db.query(
        'INSERT INTO xp_transactions 
         (user_id, type, amount, sender_id, receiver_id, description) 
         VALUES ($1, $2, $3, $4, $5, $6)',
        [
          senderId,
          'transferred_out',
          xp_points,
          senderId,
          recipient[0].id,
          description || 'XP transfer to ${recipient[0].username}'
        ]
      );
      
      // Create recipient XP transaction
      await db.query(
        'INSERT INTO xp_transactions 
         (user_id, type, amount, sender_id, receiver_id, description) 
         VALUES ($1, $2, $3, $4, $5, $6)',
        [
          recipient[0].id,
          'transferred_in',
          xp_points,
          senderId,
          recipient[0].id,
          description || 'XP transfer from ${sender[0].username}'
        ]
      );
      
      await db.query('COMMIT');
      
      res.json({
        success: true,
        message: 'XP transfer successful',
        xp_points,
        recipient: recipient[0].username
      });
      
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('Error transferring XP:', error);
    res.status(500).json({ success: false, message: 'Error transferring XP' });
  }
});

// Request withdrawal
router.post('/withdraw/request', authenticateToken, async (req, res) => {
  try {
    const { amount, bank_name, bank_code, account_number, account_name, pin } = req.body;
    const userId = req.user.id;
    
    if (!amount || !bank_name || !bank_code || !account_number || !account_name || !pin) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }
    
    if (amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Amount must be greater than 0' 
      });
    }
    
    // Verify transaction PIN
    const pinVerification = await verifyTransactionPin(userId, pin);
    if (!pinVerification.valid) {
      return res.status(401).json({ 
        success: false, 
        message: pinVerification.message 
      });
    }
    
    // Check user balance
    const { rows: user } = await db.query(
      'SELECT balance, currency, username FROM users WHERE id = $1',
      [userId]
    );
    
    if (parseFloat(user[0].balance) < parseFloat(amount)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient balance' 
      });
    }
    
    // Check minimum withdrawal amount (e.g., 1000 NGN)
    if (amount < 1000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Minimum withdrawal amount is 1000' 
      });
    }
    
    // Use PostgreSQL transaction
    await db.query('BEGIN');
    
    try {
      // Reserve the amount (deduct from balance)
      await db.query(
        'UPDATE users SET balance = balance - $1 WHERE id = $2',
        [amount, userId]
      );
      
      // Create transaction
      const reference = 'XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}';
      const { rows: txResult } = await db.query(
        'INSERT INTO transactions 
         (user_id, amount, currency, type, status, reference, description, account_details) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [
          userId, 
          -amount, 
          user[0].currency, 
          'withdrawal', 
          'pending_approval', 
          reference,
          'Withdrawal request to bank',
          JSON.stringify({
            bank_name,
            bank_code,
            account_number,
            account_name,
            user_id: userId,
            username: user[0].username
          })
        ]
      );
      
      // Generate receipt number
      const receiptNumber = 'XPR-${Date.now()}-${userId.toString().padStart(6, '0')}';
      
      // Create withdrawal request
      await db.query(
        'INSERT INTO withdrawal_requests 
         (user_id, transaction_id, amount, currency, bank_name, bank_code, 
          account_number, account_name, status, receipt_number) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [
          userId,
          txResult[0].id,
          amount,
          user[0].currency,
          bank_name,
          bank_code,
          account_number,
          account_name,
          'pending',
          receiptNumber
        ]
      );
      
      await db.query('COMMIT');
      
      res.json({
        success: true,
        message: 'Withdrawal request submitted successfully',
        receipt_number: receiptNumber,
        amount,
        status: 'pending_approval'
      });
      
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('Error requesting withdrawal:', error);
    res.status(500).json({ success: false, message: 'Error requesting withdrawal' });
  }
});

// Get bank details
router.get('/bank-details', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const { rows: bankDetails } = await db.query(
      'SELECT * FROM user_bank_details WHERE user_id = $1',
      [userId]
    );
    
    res.json({
      success: true,
      bank_details: bankDetails.length > 0 ? JSON.parse(bankDetails[0].bank_details) : null
    });
    
  } catch (error) {
    console.error('Error fetching bank details:', error);
    res.status(500).json({ success: false, message: 'Error fetching bank details' });
  }
});

// Save bank details
router.post('/bank-details', authenticateToken, async (req, res) => {
  try {
    const { bank_name, bank_code, account_number, account_name } = req.body;
    const userId = req.user.id;
    
    if (!bank_name || !bank_code || !account_number || !account_name) {
      return res.status(400).json({ 
        success: false, 
        message: 'All bank details are required' 
      });
    }
    
    const bankDetails = {
      bank_name,
      bank_code,
      account_number,
      account_name,
      saved_at: new Date().toISOString()
    };
    
    // Check if already exists
    const { rows: existing } = await db.query(
      'SELECT id FROM user_bank_details WHERE user_id = $1',
      [userId]
    );
    
    if (existing.length > 0) {
      // Update
      await db.query(
        'UPDATE user_bank_details SET bank_details = $1, updated_at = NOW() WHERE user_id = $2',
        [JSON.stringify(bankDetails), userId]
      );
    } else {
      // Insert
      await db.query(
        'INSERT INTO user_bank_details (user_id, bank_details) VALUES ($1, $2)',
        [userId, JSON.stringify(bankDetails)]
      );
    }
    
    res.json({
      success: true,
      message: 'Bank details saved successfully',
      bank_details: bankDetails
    });
    
  } catch (error) {
    console.error('Error saving bank details:', error);
    res.status(500).json({ success: false, message: 'Error saving bank details' });
  }
});

// Set transaction PIN (for settings page)
router.post('/set-pin', authenticateToken, async (req, res) => {
  try {
    const { pin, confirm_pin } = req.body;
    const userId = req.user.id;
    
    if (!pin || !confirm_pin) {
      return res.status(400).json({ 
        success: false, 
        message: 'PIN and confirmation are required' 
      });
    }
    
    if (pin !== confirm_pin) {
      return res.status(400).json({ 
        success: false, 
        message: 'PINs do not match' 
      });
    }
    
    if (pin.length !== 4) {
      return res.status(400).json({ 
        success: false, 
        message: 'PIN must be 4 digits' 
      });
    }
    
    // Hash the PIN (in production, use bcrypt with salt)
    const hashedPin = crypto.createHash('sha256').update(pin).digest('hex');
    
    // Update user
    await db.query(
      'UPDATE users SET transaction_pin = $1, pin_set_at = NOW() WHERE id = $2',
      [hashedPin, userId]
    );
    
    res.json({
      success: true,
      message: 'Transaction PIN set successfully'
    });
    
  } catch (error) {
    console.error('Error setting transaction PIN:', error);
    res.status(500).json({ success: false, message: 'Error setting transaction PIN' });
  }
});

// Verify transaction PIN (for settings page)
router.post('/verify-pin', authenticateToken, async (req, res) => {
  try {
    const { pin } = req.body;
    const userId = req.user.id;
    
    const pinVerification = await verifyTransactionPin(userId, pin);
    
    res.json({
      success: pinVerification.valid,
      message: pinVerification.message
    });
    
  } catch (error) {
    console.error('Error verifying PIN:', error);
    res.status(500).json({ success: false, message: 'Error verifying PIN' });
  }
});

module.exports = router;`;

const filePath = path.join(__dirname, 'src', 'routes', 'wallet.js');

console.log('🔄 RESTORING wallet.js to original state...\n');

try {
  fs.writeFileSync(filePath, originalWalletContent);
  console.log('✅ wallet.js has been RESTORED to original working state!');
  console.log('\n📝 Next steps:');
  console.log('1. Restart server: npm run dev');
  console.log('2. The original error was: db.query() returns [rows, fields] but you were using { rows: user }');
  console.log('3. You need to manually fix the /balance route ONLY');
  console.log('\n💡 Just fix ONE route at a time instead of using scripts.');
} catch (error) {
  console.error('❌ Error restoring file:', error.message);
}