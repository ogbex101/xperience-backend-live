const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const supabase = db.isSupabase ? db.supabaseBuilder : null;
const supabaseBuilder = db.isSupabase ? db.supabaseBuilder : null;
// Helper to get authenticated Supabase client for the current user
const getAuthSupabase = (token) => {
  if (!db.isSupabase) return db;
  
  const { createClient } = require('@supabase/supabase-js');
  
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );
};
// Helper function to verify transaction PIN
const verifyTransactionPin = async (userId, pin) => {
  if (db.isSupabase) {
    const { data: user, error } = await db.supabase
      .from('users')
      .select('transaction_pin')
      .eq('id', userId)
      .single();
    
    if (error || !user || !user.transaction_pin) {
      return { valid: false, message: 'Transaction PIN not set' };
    }
    
    // Compare hashed PIN
    const inputPinHash = crypto.createHash('sha256').update(pin).digest('hex');
    
    return {
      valid: inputPinHash === user.transaction_pin,
      message: inputPinHash === user.transaction_pin ? 'PIN valid' : 'Invalid PIN'
    };
  } else {
    const userResult = await db.query(
      'SELECT transaction_pin FROM users WHERE id = $1',
      [userId]
    );
    
    const rows = userResult[0];
    const user = rows && rows.length > 0 ? rows[0] : null;
    
    if (!user || !user.transaction_pin) {
      return { valid: false, message: 'Transaction PIN not set' };
    }
    
    // Compare hashed PIN
    const inputPinHash = crypto.createHash('sha256').update(pin).digest('hex');
    
    return {
      valid: inputPinHash === user.transaction_pin,
      message: inputPinHash === user.transaction_pin ? 'PIN valid' : 'Invalid PIN'
    };
  }
};

// Helper function to get user data
const getUserData = async (userId, fields = '*') => {
  if (db.isSupabase) {
    const { data, error } = await db.supabase
      .from('users')
      .select(fields)
      .eq('id', userId)
      .single();
    
    if (error) return null;
    return data;
  } else {
    const result = await db.query(
      `SELECT ${fields} FROM users WHERE id = $1`,
      [userId]
    );
    const rows = result[0];
    return rows && rows.length > 0 ? rows[0] : null;
  }
};

// Helper function to insert transaction
const insertTransaction = async (transactionData) => {
  if (db.isSupabase) {
    const { data, error } = await db.supabase
      .from('transactions')
      .insert([transactionData])
      .select();
    
    if (error) throw error;
    return data[0];
  } else {
    const keys = Object.keys(transactionData);
    const values = Object.values(transactionData);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await db.query(
      `INSERT INTO transactions (${keys.join(', ')}) 
       VALUES (${placeholders}) RETURNING id`,
      values
    );
    
    const rows = result[0];
    return rows && rows.length > 0 ? rows[0] : null;
  }
};

// Helper function to insert XP transaction
const insertXpTransaction = async (xpTransactionData) => {
  if (db.isSupabase) {
    const { data, error } = await db.supabase
      .from('xp_transactions')
      .insert([xpTransactionData])
      .select();
    
    if (error) throw error;
    return data[0];
  } else {
    const keys = Object.keys(xpTransactionData);
    const values = Object.values(xpTransactionData);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const result = await db.query(
      `INSERT INTO xp_transactions (${keys.join(', ')}) 
       VALUES (${placeholders}) RETURNING id`,
      values
    );
    
    const rows = result[0];
    return rows && rows.length > 0 ? rows[0] : null;
  }
};
// Add this debug route at the very top of wallet.js, before any other routes
router.get('/debug', (req, res) => {
  console.log('🔍 Wallet debug route hit!');
  res.json({ 
    success: true, 
    message: 'Wallet router is working',
    routes: [
      'GET /balance',
      'GET /check-pin-status', 
      'GET /transactions',
      'GET /xp-transactions',
      'POST /convert/to-xp',
      'POST /transfer/funds',
      'POST /transfer/xp',
      'POST /withdraw/request',
      'GET /bank-details',
      'POST /bank-details',
      'POST /set-pin',
      'POST /verify-pin',
      'POST /simulate-deposit',
      'GET /currencies',
      'POST /set-currency',
      'POST /fund/initialize',
      'POST /fund/webhook'
    ]
  });
});

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
    
    if (db.isSupabase) {
      const { error } = await db.supabase
        .from('users')
        .update({ currency })
        .eq('id', userId);
      
      if (error) throw error;
    } else {
      await db.query(
        'UPDATE users SET currency = $1 WHERE id = $2',
        [currency, userId]
      );
    }
    
    res.json({
      success: true,
      message: `Currency updated to ${currency}`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating currency' });
  }
});

// Get wallet balance and XP points
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('Fetching balance for user ID:', userId);
    
    let user;
    if (db.isSupabase) {
      const { data, error } = await db.supabase
        .from('users')
        .select('balance, xp_points, wallet_account_number, currency')
        .eq('id', userId)
        .single();
      
      if (error) throw error;
      user = data;
    } else {
      const userResult = await db.query(
        'SELECT balance, xp_points, wallet_account_number, currency FROM users WHERE id = $1',
        [userId]
      );
      
      console.log('Database query result:', userResult);
      
      const rows = userResult[0];
      user = rows && rows.length > 0 ? rows[0] : null;
    }
    
    console.log('User data:', user);
    
    if (!user) {
      console.log('User not found');
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    console.log('Balance:', user.balance);
    console.log('Currency:', user.currency);
    
    // Get XP rate
    let xpRate;
    if (db.isSupabase) {
      const { data, error } = await db.supabase
        .from('xp_rates')
        .select('xp_per_unit, unit_amount')
        .eq('currency', user.currency || 'NGN')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (!error) {
        xpRate = data;
      }
    } else {
      const xpRateResult = await db.query(
        'SELECT xp_per_unit, unit_amount FROM xp_rates WHERE currency = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 1',
        [user.currency || 'NGN']
      );
      
      const xpRateRows = xpRateResult[0];
      xpRate = xpRateRows && xpRateRows.length > 0 ? xpRateRows[0] : null;
    }

    // Default rates if none found
    const defaultRates = {
      'NGN': { xp_per_unit: 50, unit_amount: 1000 }, // 1000 NGN = 50 XP
      'USD': { xp_per_unit: 50, unit_amount: 10 },    // 10 USD = 50 XP (assuming 1 USD = 100 NGN)
      'EUR': { xp_per_unit: 50, unit_amount: 9 },     // 9 EUR = 50 XP
      'GBP': { xp_per_unit: 50, unit_amount: 8 }      // 8 GBP = 50 XP
    };

    const responseData = {
      success: true,
      balance: parseFloat(user.balance) || 0,
      xp_points: parseInt(user.xp_points) || 0,
      wallet_account_number: user.wallet_account_number,
      currency: user.currency,
      xp_rate: xpRate || defaultRates[user.currency] || defaultRates['NGN']
    };
    
    console.log('Sending response:', responseData);
    
    res.json(responseData);
    
  } catch (error) {
    console.error('Error fetching wallet balance:', error);
    res.status(500).json({ success: false, message: 'Error fetching wallet balance' });
  }
});

// Check PIN status
router.get('/check-pin-status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    let user;
    if (db.isSupabase) {
      const { data, error } = await db.supabase
        .from('users')
        .select('transaction_pin, pin_set_at')
        .eq('id', userId)
        .single();
      
      if (error) throw error;
      user = data;
    } else {
      const userResult = await db.query(
        'SELECT transaction_pin, pin_set_at FROM users WHERE id = $1',
        [userId]
      );
      
      const rows = userResult[0];
      user = rows && rows.length > 0 ? rows[0] : null;
    }
    
    if (!user) {
      return res.json({
        success: false,
        message: 'User not found',
        has_pin: false
      });
    }
    
    const hasPin = !!user.transaction_pin;
    
    res.json({
      success: true,
      has_pin: hasPin,
      pin_set_at: user.pin_set_at,
      transaction_pin_set: hasPin ? 'Yes' : 'No'
    });
    
  } catch (error) {
    console.error('Error checking PIN status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error checking PIN status' 
    });
  }
});

// Get transaction history
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, limit = 50, offset = 0 } = req.query;
    
    let transactions = [];
    let xpTransactions = [];
    
    if (db.isSupabase) {
      // Get regular transactions
      let query = db.supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
      
      if (type) {
        query = query.eq('type', type);
      }
      
      const { data, error } = await query;
      if (!error) {
        transactions = data || [];
      }

      // Get XP transactions
      const { data: xpData, error: xpError } = await db.supabase
        .from('xp_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));
      
      if (!xpError) {
        xpTransactions = xpData || [];
      }
      
    } else {
      let query = `
        SELECT * FROM transactions 
        WHERE user_id = $1 
      `;
      const params = [userId];
      let paramIndex = 2;
      
      if (type) {
        query += ` AND type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }
      
      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(parseInt(limit), parseInt(offset));
      
      const transactionsResult = await db.query(query, params);
      const transactionsRows = transactionsResult[0] || [];
      transactions = transactionsRows;
      
      // Get XP transactions too
      const xpTransactionsResult = await db.query(
        'SELECT * FROM xp_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [userId, limit]
      );
      
      const xpTransactionsRows = xpTransactionsResult[0] || [];
      xpTransactions = xpTransactionsRows;
    }
    
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
    
    let transactions = [];
    
    if (db.isSupabase) {
      let query = db.supabase
        .from('xp_transactions')
        .select(`
          *,
          sender:sender_id (username),
          receiver:receiver_id (username)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
      
      if (type) {
        query = query.eq('type', type);
      }
      
      const { data, error } = await query;
      
      if (!error) {
        transactions = (data || []).map(t => ({
          ...t,
          sender_username: t.sender?.username,
          receiver_username: t.receiver?.username
        }));
      }
      
    } else {
      let query = `
        SELECT xt.*, 
          u1.username AS sender_username,
          u2.username AS receiver_username
        FROM xp_transactions xt
        LEFT JOIN users u1 ON xt.sender_id = u1.id
        LEFT JOIN users u2 ON xt.receiver_id = u2.id
        WHERE xt.user_id = $1
      `;
      const params = [userId];
      let paramIndex = 2;
      
      if (type) {
        query += ` AND xt.type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }
      
      query += ` ORDER BY xt.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(parseInt(limit), parseInt(offset));
      
      const transactionsResult = await db.query(query, params);
      const transactionsRows = transactionsResult[0] || [];
      transactions = transactionsRows;
    }
    
    res.json({
      success: true,
      transactions
    });
    
  } catch (error) {
    console.error('Error fetching XP transactions:', error);
    res.status(500).json({ success: false, message: 'Error fetching XP transaction history' });
  }
});
// Payment Link Method - SIMPLE & RELIABLE
router.post('/fund/payment-link', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = 'USD' } = req.body;
    const userId = req.user.id;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }
    
    // Generate unique transaction reference
    const reference = `XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create pending transaction in database
    const { data, error } = await db.supabaseAdmin
      .from('transactions')
      .insert([{
        user_id: userId,
        amount: parseFloat(amount),
        currency,
        type: 'deposit',
        status: 'pending',
        reference,
        description: 'Wallet deposit via Flutterwave Payment Link'
      }])
      .select();
    
    if (error) {
      console.error('Error creating transaction:', error);
      return res.status(500).json({ success: false, message: 'Failed to create transaction' });
    }
    
    // Your payment link (the one you created)
    const PAYMENT_LINK = 'https://flutterwave.com/pay/ppbagwxxxhep';
    
    // Append amount, reference, and customer email as query parameters
    const paymentLink = `${PAYMENT_LINK}?amount=${amount}&currency=${currency}&tx_ref=${reference}`;
    
    res.json({
      success: true,
      transaction_id: data[0].id,
      reference: reference,
      payment_link: paymentLink
    });
    
  } catch (error) {
    console.error('Error creating payment link:', error);
    res.status(500).json({ success: false, message: 'Error creating payment link' });
  }
});
// Webhook for Flutterwave Payment Link
router.post('/flutterwave-webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('📡 Webhook received:', payload);
    
    const { tx_ref, status, amount, currency } = payload.data || payload;
    
    if (status === 'successful') {
      // Find transaction
      const { data: transaction, error } = await db.supabaseAdmin
        .from('transactions')
        .select('*')
        .eq('reference', tx_ref)
        .single();
      
      if (error || !transaction) {
        console.error('Transaction not found:', tx_ref);
        return res.status(404).json({ success: false, message: 'Transaction not found' });
      }
      
      if (transaction.status === 'pending') {
        // Update user balance
        const { data: userData } = await db.supabaseAdmin
          .from('users')
          .select('balance')
          .eq('id', transaction.user_id)
          .single();
        
        const newBalance = (userData?.balance || 0) + parseFloat(transaction.amount);
        
        await db.supabaseAdmin
          .from('users')
          .update({ balance: newBalance })
          .eq('id', transaction.user_id);
        
        // Update transaction status
        await db.supabaseAdmin
          .from('transactions')
          .update({ 
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('id', transaction.id);
        
        console.log(`✅ Payment completed for user ${transaction.user_id}: +${transaction.amount}`);
      }
    }
    
    res.json({ success: true, message: 'Webhook processed' });
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ success: false, message: 'Error processing webhook' });
  }
});
router.post('/fund/initialize', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = 'NGN' } = req.body;
    const userId = req.user.id;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }
    
    const reference = `XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // USE supabaseAdmin to bypass RLS - NO token needed
    const { data, error } = await db.supabaseAdmin
      .from('transactions')
      .insert([{
        user_id: userId,
        amount,
        currency,
        type: 'deposit',
        status: 'pending',
        reference,
        description: 'Wallet deposit via Flutterwave'
      }])
      .select();
    
    if (error) {
      console.error('Error creating transaction:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
    
    const transactionId = data[0].id;
    
    // Get user details (SELECT is fine with regular client)
    const { data: user } = await db.supabase
      .from('users')
      .select('email, username')
      .eq('id', userId)
      .single();
    
    // Flutterwave payment initialization
    const paymentPayload = {
      tx_ref: reference,
      amount: parseFloat(amount),
      currency: currency,
      redirect_url: `${process.env.CLIENT_URL}/wallet/callback`,
      customer: {
        email: user?.email || 'customer@example.com',
        name: user?.username || 'User',
      },
      customizations: {
        title: "XP Gaming Wallet",
        description: `Deposit of ${amount} ${currency}`,
        logo: "https://your-logo-url.com/logo.png"
      }
    };
    
    const flutterwaveResponse = await fetch('https://api.flutterwave.com/v3/payments', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': process.env.FLUTTERWAVE_CLIENT_SECRET  // Just the secret, no "Bearer"
  },
  body: JSON.stringify(paymentPayload)
});
    
    const flutterwaveData = await flutterwaveResponse.json();
    
    if (flutterwaveData.status === 'success') {
      res.json({
        success: true,
        transaction_id: transactionId,
        reference: reference,
        payment_link: flutterwaveData.data.link
      });
    } else {
      // Update transaction to failed using supabaseAdmin
      await db.supabaseAdmin
        .from('transactions')
        .update({ status: 'failed' })
        .eq('id', transactionId);
      
      res.status(400).json({
        success: false,
        message: flutterwaveData.message || 'Payment initialization failed'
      });
    }
    
  } catch (error) {
    console.error('Error initializing payment:', error);
    res.status(500).json({ success: false, message: 'Error initializing payment' });
  }
});
router.post('/fund/webhook', async (req, res) => {
  try {
    const secretHash = process.env.FLW_SECRET_HASH;
    const signature = req.headers['verif-hash'];
    
    console.log('📡 Webhook received');
    
    // Verify webhook signature
    if (!signature || signature !== secretHash) {
      console.log('❌ Invalid webhook signature');
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const payload = req.body;
    console.log('📡 Webhook payload:', JSON.stringify(payload, null, 2));
    
    const { tx_ref, status, amount, currency } = payload.data;
    
    if (status === 'successful') {
      // Find transaction
      let transaction;
      if (db.isSupabase) {
        const { data, error } = await db.supabase
          .from('transactions')
          .select('*')
          .eq('reference', tx_ref)
          .single();
        
        if (error || !data) {
          console.error('Transaction not found:', tx_ref);
          return res.status(404).json({ success: false, message: 'Transaction not found' });
        }
        transaction = data;
      } else {
        const result = await db.query(
          'SELECT * FROM transactions WHERE reference = $1',
          [tx_ref]
        );
        const rows = result[0];
        if (!rows || rows.length === 0) {
          console.error('Transaction not found:', tx_ref);
          return res.status(404).json({ success: false, message: 'Transaction not found' });
        }
        transaction = rows[0];
      }
      
      // Only process if still pending
      if (transaction.status === 'pending') {
        // Update user balance
        if (db.isSupabase) {
          const { data: userData } = await db.supabase
            .from('users')
            .select('balance')
            .eq('id', transaction.user_id)
            .single();
          
          const newBalance = (userData?.balance || 0) + parseFloat(transaction.amount);
          
          await db.supabase
            .from('users')
            .update({ balance: newBalance })
            .eq('id', transaction.user_id);
        } else {
          await db.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2',
            [parseFloat(transaction.amount), transaction.user_id]
          );
        }
        
        // Update transaction status
        if (db.isSupabase) {
          await db.supabase
            .from('transactions')
            .update({ 
              status: 'completed',
              completed_at: new Date().toISOString()
            })
            .eq('id', transaction.id);
        } else {
          await db.query(
            'UPDATE transactions SET status = $1, completed_at = NOW() WHERE id = $2',
            ['completed', transaction.id]
          );
        }
        
        console.log(`✅ Payment completed for user ${transaction.user_id}: +${transaction.amount}`);
      }
    }
    
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
    let sender, recipient;
    
    if (db.isSupabase) {
      // Get sender data
      const { data: senderData, error: senderError } = await db.supabase
        .from('users')
        .select('balance, currency, wallet_account_number, username')
        .eq('id', senderId)
        .single();
      
      if (senderError) throw senderError;
      sender = senderData;
      
      if (parseFloat(sender.balance) < parseFloat(amount)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Insufficient balance' 
        });
      }
      
      // Find recipient
      const { data: recipientData, error: recipientError } = await db.supabase
        .from('users')
        .select('id, username')
        .eq('wallet_account_number', recipient_account)
        .single();
      
      if (recipientError || !recipientData) {
        return res.status(404).json({ 
          success: false, 
          message: 'Recipient not found' 
        });
      }
      recipient = recipientData;
      
      if (recipient.id === senderId) {
        return res.status(400).json({ 
          success: false, 
          message: 'Cannot transfer to yourself' 
        });
      }
      
      // Perform transfer in Supabase (sequential with error handling)
      // 1. Deduct from sender
      const { error: deductError } = await db.supabase
        .from('users')
        .update({ balance: db.supabase.rpc('decrement', { x: parseFloat(amount) }) })
        .eq('id', senderId);
      
      if (deductError) throw deductError;
      
      // 2. Add to recipient
      const { error: addError } = await db.supabase
        .from('users')
        .update({ balance: db.supabase.rpc('increment', { x: parseFloat(amount) }) })
        .eq('id', recipient.id);
      
      if (addError) throw addError;
      
      // 3. Create sender transaction
      const senderReference = `XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const { error: txError1 } = await db.supabase
        .from('transactions')
        .insert([{
          user_id: senderId,
          amount: -amount,
          currency: sender.currency,
          type: 'transfer',
          status: 'completed',
          reference: senderReference,
          description: description || `Fund transfer to ${recipient.username}`,
          external_reference: JSON.stringify({
            recipient_id: recipient.id,
            recipient_name: recipient.username,
            recipient_account: recipient_account
          })
        }]);
      
      if (txError1) throw txError1;
      
      // 4. Create recipient transaction
      const recipientReference = `XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const { error: txError2 } = await db.supabase
        .from('transactions')
        .insert([{
          user_id: recipient.id,
          amount: amount,
          currency: sender.currency,
          type: 'deposit',
          status: 'completed',
          reference: recipientReference,
          description: description || `Fund transfer from ${sender.username}`,
          external_reference: JSON.stringify({
            sender_id: senderId,
            sender_name: sender.username,
            sender_account: sender.wallet_account_number
          })
        }]);
      
      if (txError2) throw txError2;
      
    } else {
      // Original PostgreSQL with transaction
      await db.query('BEGIN');
      
      try {
        const senderResult = await db.query(
          'SELECT balance, currency, wallet_account_number, username FROM users WHERE id = $1',
          [senderId]
        );
        
        const senderRows = senderResult[0];
        sender = senderRows && senderRows.length > 0 ? senderRows[0] : null;
        
        if (parseFloat(sender.balance) < parseFloat(amount)) {
          await db.query('ROLLBACK');
          return res.status(400).json({ 
            success: false, 
            message: 'Insufficient balance' 
          });
        }
        
        const recipientResult = await db.query(
          'SELECT id, username FROM users WHERE wallet_account_number = $1',
          [recipient_account]
        );
        
        const recipientRows = recipientResult[0];
        recipient = recipientRows && recipientRows.length > 0 ? recipientRows[0] : null;
        
        if (!recipient) {
          await db.query('ROLLBACK');
          return res.status(404).json({ 
            success: false, 
            message: 'Recipient not found' 
          });
        }
        
        if (recipient.id === senderId) {
          await db.query('ROLLBACK');
          return res.status(400).json({ 
            success: false, 
            message: 'Cannot transfer to yourself' 
          });
        }
        
        // Deduct from sender
        await db.query(
          'UPDATE users SET balance = balance - $1 WHERE id = $2',
          [amount, senderId]
        );
        
        // Add to recipient
        await db.query(
          'UPDATE users SET balance = balance + $1 WHERE id = $2',
          [amount, recipient.id]
        );
        
        // Create sender transaction
        const senderReference = `XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await db.query(
          `INSERT INTO transactions (user_id, amount, currency, type, status, reference, description, external_reference) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            senderId, 
            -amount, 
            sender.currency, 
            'transfer', 
            'completed', 
            senderReference,
            description || `Fund transfer to ${recipient.username}`,
            JSON.stringify({
              recipient_id: recipient.id,
              recipient_name: recipient.username,
              recipient_account: recipient_account
            })
          ]
        );
        
        // Create recipient transaction
        const recipientReference = `XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await db.query(
          `INSERT INTO transactions (user_id, amount, currency, type, status, reference, description, external_reference) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            recipient.id, 
            amount, 
            sender.currency, 
            'deposit', 
            'completed', 
            recipientReference,
            description || `Fund transfer from ${sender.username}`,
            JSON.stringify({
              sender_id: senderId,
              sender_name: sender.username,
              sender_account: sender.wallet_account_number
            })
          ]
        );
        
        await db.query('COMMIT');
        
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
    
    res.json({
      success: true,
      message: 'Transfer successful',
      amount,
      recipient: recipient.username
    });
    
  } catch (error) {
    console.error('Error transferring funds:', error);
    res.status(500).json({ success: false, message: 'Error transferring funds' });
  }
});

// Convert money to XP points - FIXED VERSION
router.post('/convert/to-xp', authenticateToken, async (req, res) => {
  try {
    const { amount, pin } = req.body;
    const userId = req.user.id;
    
    console.log('=== CONVERT TO XP - REQUEST BODY ===');
    console.log('Full request body:', req.body);
    console.log('User ID:', userId);
    console.log('Database mode:', db.isSupabase ? 'Supabase' : 'PostgreSQL');
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid amount is required'
      });
    }
    
    if (!pin) {
      return res.status(400).json({ 
        success: false, 
        message: 'PIN is required'
      });
    }
    
    const parsedAmount = parseFloat(amount);
    
    // Verify transaction PIN
    console.log('=== PIN VERIFICATION DEBUG ===');
    const pinVerification = await verifyTransactionPin(userId, pin);
    console.log('PIN verification result:', pinVerification);
    
    if (!pinVerification.valid) {
      return res.status(401).json({ 
        success: false, 
        message: pinVerification.message
      });
    }
    
    if (db.isSupabase) {
      console.log('=== USING SUPABASE ===');
      
      // Get user data using db.supabase (not supabase function)
      const { data: userData, error: userError } = await db.supabase
        .from('users')
        .select('balance, currency, xp_points')
        .eq('id', userId)
        .single();
      
      if (userError) {
        console.error('Error fetching user:', userError);
        return res.status(500).json({ 
          success: false, 
          message: 'Error fetching user data',
          debug: userError.message 
        });
      }
      
      console.log('=== USER BALANCE DEBUG ===');
      console.log('User data:', userData);
      
      if (!userData) {
        return res.status(404).json({ 
          success: false, 
          message: 'User not found' 
        });
      }
      
      const userBalance = parseFloat(userData.balance || 0);
      if (userBalance < parsedAmount) {
        return res.status(400).json({ 
          success: false, 
          message: 'Insufficient balance'
        });
      }
      
      // Get XP rate using db.supabase (not supabase function)
      console.log('=== XP RATE DEBUG ===');
      console.log('Fetching rate for currency:', userData.currency || 'USD');
      
      // First, let's check if the table exists and has data
      const { data: allRates, error: allRatesError } = await db.supabase
        .from('xp_rates')
        .select('*')
        .limit(10);
      
      console.log('All rates in table (first 10):', allRates);
      if (allRatesError) {
        console.error('Error fetching all rates:', allRatesError);
      }
      
      // Now get the specific rate
      const { data: rateData, error: rateError } = await db.supabase
        .from('xp_rates')
        .select('*')
        .eq('currency', userData.currency || 'USD')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (rateError) {
        console.error('Error fetching XP rate:', rateError);
        return res.status(500).json({ 
          success: false, 
          message: 'Error fetching conversion rate',
          debug: rateError.message 
        });
      }
      
      console.log('Rate data from Supabase:', rateData);
      
      if (!rateData) {
        // Check if there are any active rates at all
        const { data: activeRates } = await db.supabase
          .from('xp_rates')
          .select('*')
          .eq('is_active', true);
        
        console.log('All active rates in database:', activeRates);
        
        return res.status(400).json({ 
          success: false, 
          message: 'XP conversion rate not available',
          debug: { 
            userCurrency: userData.currency || 'USD',
            availableRates: activeRates || [],
            allRates: allRates || []
          }
        });
      }
      
      // Calculate XP points
      const unitAmount = parseFloat(rateData.unit_amount);
      const xpPerUnit = parseFloat(rateData.xp_per_unit);
      const xpPoints = Math.floor((parsedAmount / unitAmount) * xpPerUnit);
      
      console.log('=== XP CALCULATION ===');
      console.log('Amount:', parsedAmount);
      console.log('Unit amount:', unitAmount);
      console.log('XP per unit:', xpPerUnit);
      console.log('Calculated XP points:', xpPoints);
      
      if (xpPoints <= 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Amount too small to convert. Minimum conversion required.'
        });
      }
      
      // Check if admin client is available
      if (!db.supabaseAdmin) {
        console.error('Admin client not available');
        return res.status(500).json({
          success: false,
          message: 'Server configuration error - admin client not available'
        });
      }
      
      // Start a transaction by using sequential operations
      console.log('=== STARTING CONVERSION ===');
      
      // 1. Deduct money
      const newBalance = userBalance - parsedAmount;
      const { error: deductError } = await db.supabaseAdmin
        .from('users')
        .update({ balance: newBalance })
        .eq('id', userId);
      
      if (deductError) {
        console.error('Error deducting balance:', deductError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to deduct balance',
          debug: deductError.message 
        });
      }
      
      // 2. Add XP points
      const newXpPoints = (userData.xp_points || 0) + xpPoints;
      const { error: xpAddError } = await db.supabaseAdmin
        .from('users')
        .update({ xp_points: newXpPoints })
        .eq('id', userId);
      
      if (xpAddError) {
        console.error('Error adding XP:', xpAddError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to add XP points',
          debug: xpAddError.message 
        });
      }
      
      // 3. Create transaction record
      const reference = `XP-CONV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const { data: txData, error: txError } = await db.supabaseAdmin
        .from('transactions')
        .insert([{
          user_id: userId,
          amount: -parsedAmount,
          currency: userData.currency,
          type: 'withdrawal',
          status: 'completed',
          reference,
          description: `Converted to ${xpPoints} XP points`
        }])
        .select();
      
      if (txError) {
        console.error('Error creating transaction:', txError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to create transaction record',
          debug: txError.message 
        });
      }
      
    const { error: xpTxError } = await db.supabaseAdmin
  .from('xp_transactions')
  .insert([{
    user_id: userId,
    type: 'converted_from_money',
    amount: xpPoints,
    description: `Converted from ${parsedAmount} ${userData.currency}`,
    metadata: {  // This is the JSONB column you have
      transaction_id: txData[0].id,
      amount_converted: parsedAmount,
      currency: userData.currency
    }
  }]);

if (xpTxError) {
  console.error('Error creating XP transaction:', xpTxError);
  return res.status(500).json({ 
    success: false, 
    message: 'Failed to create XP transaction record',
    debug: xpTxError.message 
  });
}
      console.log('=== CONVERSION COMPLETED SUCCESSFULLY ===');
      
      res.json({
        success: true,
        message: 'Conversion successful',
        amount: parsedAmount,
        xp_points: xpPoints,
        new_balance: newBalance,
        new_xp_points: newXpPoints,
        conversion_rate: {
          unit_amount: unitAmount,
          xp_per_unit: xpPerUnit
        }
      });
      
    } else {
      // PostgreSQL version (keeping your existing code)
      console.log('=== USING POSTGRESQL ===');
      
      // Get user data
      const userResult = await db.query(
        'SELECT balance, currency, xp_points FROM users WHERE id = $1',
        [userId]
      );
      
      const userRows = userResult[0];
      const user = userRows && userRows.length > 0 ? userRows[0] : null;
      
      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: 'User not found' 
        });
      }
      
      const userBalance = parseFloat(user.balance);
      if (userBalance < parsedAmount) {
        return res.status(400).json({ 
          success: false, 
          message: 'Insufficient balance'
        });
      }
      
      // Get XP rate
      const xpRateResult = await db.query(
        'SELECT xp_per_unit, unit_amount FROM xp_rates WHERE currency = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 1',
        [user.currency || 'USD']
      );
      
      const xpRateRows = xpRateResult[0];
      const xpRate = xpRateRows && xpRateRows.length > 0 ? xpRateRows[0] : null;
      
      if (!xpRate) {
        return res.status(400).json({ 
          success: false, 
          message: 'XP conversion rate not available'
        });
      }
      
      const xpPoints = Math.floor((parsedAmount / parseFloat(xpRate.unit_amount)) * parseFloat(xpRate.xp_per_unit));
      
      if (xpPoints <= 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Amount too small to convert.'
        });
      }
      
      // Use transaction
      await db.query('BEGIN');
      
      try {
        await db.query(
          'UPDATE users SET balance = balance - $1 WHERE id = $2',
          [parsedAmount, userId]
        );
        
        await db.query(
          'UPDATE users SET xp_points = COALESCE(xp_points, 0) + $1 WHERE id = $2',
          [xpPoints, userId]
        );
        
        const reference = `XP-CONV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const txResult = await db.query(
          `INSERT INTO transactions 
           (user_id, amount, currency, type, status, reference, description) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            userId, 
            -parsedAmount, 
            user.currency, 
            'withdrawal', 
            'completed', 
            reference,
            `Converted to ${xpPoints} XP points`
          ]
        );
        
        const txRows = txResult[0];
        const transaction = txRows && txRows.length > 0 ? txRows[0] : null;
        
        await db.query(
          `INSERT INTO xp_transactions 
           (user_id, type, amount, related_transaction_id, description) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            userId,
            'converted_from_money',
            xpPoints,
            transaction.id,
            `Converted from ${parsedAmount} ${user.currency}`
          ]
        );
        
        await db.query('COMMIT');
        
        const updatedUserResult = await db.query(
          'SELECT balance, xp_points FROM users WHERE id = $1',
          [userId]
        );
        
        const updatedRows = updatedUserResult[0];
        const updatedUser = updatedRows && updatedRows.length > 0 ? updatedRows[0] : null;
        
        res.json({
          success: true,
          message: 'Conversion successful',
          amount: parsedAmount,
          xp_points: xpPoints,
          new_balance: parseFloat(updatedUser.balance),
          new_xp_points: parseInt(updatedUser.xp_points),
          conversion_rate: {
            unit_amount: parseFloat(xpRate.unit_amount),
            xp_per_unit: parseFloat(xpRate.xp_per_unit)
          }
        });
        
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
    
  } catch (error) {
    console.error('=== ERROR IN CONVERT TO XP ===');
    console.error('Error:', error);
    
    res.status(500).json({ 
      success: false, 
      message: 'Error converting to XP',
      debug: error.message 
    });
  }
});
// Transfer XP points to another user - FIXED VERSION
router.post('/transfer/xp', authenticateToken, async (req, res) => {
  try {
    const { recipient_account, xp_points, pin, description } = req.body;
    const senderId = req.user.id;
    
    console.log('💰 XP Transfer request:', { recipient_account, xp_points, senderId });
    
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
    
    let sender, recipient;
    
    if (db.isSupabase) {
      // Get sender data - USE ADMIN CLIENT
      const { data: senderData, error: senderError } = await db.supabaseAdmin
        .from('users')
        .select('xp_points, username')
        .eq('id', senderId)
        .single();
      
      if (senderError) {
        console.error('Error fetching sender:', senderError);
        throw senderError;
      }
      sender = senderData;
      
      if ((parseInt(sender.xp_points) || 0) < parseInt(xp_points)) {
        return res.status(400).json({ 
          success: false, 
          message: `Insufficient XP points. You have ${sender.xp_points || 0} XP` 
        });
      }
      
      // Find recipient by wallet account number - USE ADMIN CLIENT
      const { data: recipientData, error: recipientError } = await db.supabaseAdmin
        .from('users')
        .select('id, username, xp_points')
        .eq('wallet_account_number', recipient_account)
        .single();
      
      if (recipientError || !recipientData) {
        console.error('Recipient not found:', recipient_account);
        return res.status(404).json({ 
          success: false, 
          message: 'Recipient not found. Please check the account number.' 
        });
      }
      recipient = recipientData;
      
      if (recipient.id === senderId) {
        return res.status(400).json({ 
          success: false, 
          message: 'Cannot transfer XP to yourself' 
        });
      }
      
      // Calculate new XP values
      const newSenderXp = (parseInt(sender.xp_points) || 0) - parseInt(xp_points);
      const newRecipientXp = (parseInt(recipient.xp_points) || 0) + parseInt(xp_points);
      
      console.log('XP Transfer calculation:', {
        sender: { old: sender.xp_points, new: newSenderXp },
        recipient: { old: recipient.xp_points, new: newRecipientXp },
        amount: xp_points
      });
      
      // 1. Deduct from sender
      const { error: deductError } = await db.supabaseAdmin
        .from('users')
        .update({ xp_points: newSenderXp })
        .eq('id', senderId);
      
      if (deductError) {
        console.error('Error deducting XP:', deductError);
        throw deductError;
      }
      
      // 2. Add to recipient
      const { error: addError } = await db.supabaseAdmin
        .from('users')
        .update({ xp_points: newRecipientXp })
        .eq('id', recipient.id);
      
      if (addError) {
        console.error('Error adding XP:', addError);
        // Try to rollback sender deduction
        await db.supabaseAdmin
          .from('users')
          .update({ xp_points: sender.xp_points })
          .eq('id', senderId);
        throw addError;
      }
      
      // 3. Create sender XP transaction
      const { error: txError1 } = await db.supabaseAdmin
        .from('xp_transactions')
        .insert([{
          user_id: senderId,
          type: 'transferred_out',
          amount: parseInt(xp_points),
          sender_id: senderId,
          receiver_id: recipient.id,
          description: description || `XP transfer to ${recipient.username}`
        }]);
      
      if (txError1) {
        console.error('Error creating sender transaction:', txError1);
        // Don't throw, transaction is already complete
      }
      
      // 4. Create recipient XP transaction
      const { error: txError2 } = await db.supabaseAdmin
        .from('xp_transactions')
        .insert([{
          user_id: recipient.id,
          type: 'transferred_in',
          amount: parseInt(xp_points),
          sender_id: senderId,
          receiver_id: recipient.id,
          description: description || `XP transfer from ${sender.username}`
        }]);
      
      if (txError2) {
        console.error('Error creating recipient transaction:', txError2);
        // Don't throw, transaction is already complete
      }
      
      console.log('✅ XP Transfer successful:', { from: senderId, to: recipient.id, amount: xp_points });
      
    } else {
      // PostgreSQL with transaction
      await db.query('BEGIN');
      
      try {
        const senderResult = await db.query(
          'SELECT xp_points, username FROM users WHERE id = $1',
          [senderId]
        );
        
        const senderRows = senderResult[0];
        sender = senderRows && senderRows.length > 0 ? senderRows[0] : null;
        
        if ((parseInt(sender.xp_points) || 0) < parseInt(xp_points)) {
          await db.query('ROLLBACK');
          return res.status(400).json({ 
            success: false, 
            message: 'Insufficient XP points' 
          });
        }
        
        const recipientResult = await db.query(
          'SELECT id, username, xp_points FROM users WHERE wallet_account_number = $1',
          [recipient_account]
        );
        
        const recipientRows = recipientResult[0];
        recipient = recipientRows && recipientRows.length > 0 ? recipientRows[0] : null;
        
        if (!recipient) {
          await db.query('ROLLBACK');
          return res.status(404).json({ 
            success: false, 
            message: 'Recipient not found' 
          });
        }
        
        if (recipient.id === senderId) {
          await db.query('ROLLBACK');
          return res.status(400).json({ 
            success: false, 
            message: 'Cannot transfer to yourself' 
          });
        }
        
        // Deduct from sender
        await db.query(
          'UPDATE users SET xp_points = COALESCE(xp_points, 0) - $1 WHERE id = $2',
          [xp_points, senderId]
        );
        
        // Add to recipient
        await db.query(
          'UPDATE users SET xp_points = COALESCE(xp_points, 0) + $1 WHERE id = $2',
          [xp_points, recipient.id]
        );
        
        // Create sender XP transaction
        await db.query(
          `INSERT INTO xp_transactions 
           (user_id, type, amount, sender_id, receiver_id, description) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            senderId,
            'transferred_out',
            xp_points,
            senderId,
            recipient.id,
            description || `XP transfer to ${recipient.username}`
          ]
        );
        
        // Create recipient XP transaction
        await db.query(
          `INSERT INTO xp_transactions 
           (user_id, type, amount, sender_id, receiver_id, description) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            recipient.id,
            'transferred_in',
            xp_points,
            senderId,
            recipient.id,
            description || `XP transfer from ${sender.username}`
          ]
        );
        
        await db.query('COMMIT');
        
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
    
    res.json({
      success: true,
      message: `Successfully transferred ${xp_points} XP to ${recipient.username}`,
      xp_points: parseInt(xp_points),
      recipient: recipient.username,
      new_sender_balance: parseInt(sender.xp_points) - parseInt(xp_points)
    });
    
  } catch (error) {
    console.error('Error transferring XP:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error transferring XP: ' + error.message 
    });
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
    let user;
    
    if (db.isSupabase) {
      const { data, error } = await db.supabase
        .from('users')
        .select('balance, currency, username')
        .eq('id', userId)
        .single();
      
      if (error) throw error;
      user = data;
      
    } else {
      const userResult = await db.query(
        'SELECT balance, currency, username FROM users WHERE id = $1',
        [userId]
      );
      
      const userRows = userResult[0];
      user = userRows && userRows.length > 0 ? userRows[0] : null;
    }
    
    if (parseFloat(user.balance) < parseFloat(amount)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient balance' 
      });
    }
    
    // Check minimum withdrawal amount
    if (amount < 1000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Minimum withdrawal amount is 1000' 
      });
    }
    
    let txResult, receiptNumber;
    
    if (db.isSupabase) {
      // Sequential operations for Supabase
      // 1. Reserve the amount
      const { error: deductError } = await db.supabase
        .from('users')
        .update({ balance: db.supabase.rpc('decrement', { x: parseFloat(amount) }) })
        .eq('id', userId);
      
      if (deductError) throw deductError;
      
      // 2. Create transaction
      const reference = `XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const { data: txData, error: txError } = await db.supabase
        .from('transactions')
        .insert([{
          user_id: userId,
          amount: -amount,
          currency: user.currency,
          type: 'withdrawal',
          status: 'pending_approval',
          reference,
          description: 'Withdrawal request to bank',
          account_details: JSON.stringify({
            bank_name,
            bank_code,
            account_number,
            account_name,
            user_id: userId,
            username: user.username
          })
        }])
        .select();
      
      if (txError) throw txError;
      txResult = txData[0];
      
      // 3. Generate receipt number
      receiptNumber = `XPR-${Date.now()}-${userId.toString().padStart(6, '0')}`;
      
      // 4. Create withdrawal request
      const { error: wdError } = await db.supabase
        .from('withdrawal_requests')
        .insert([{
          user_id: userId,
          transaction_id: txResult.id,
          amount,
          currency: user.currency,
          bank_name,
          bank_code,
          account_number,
          account_name,
          status: 'pending',
          receipt_number: receiptNumber
        }]);
      
      if (wdError) throw wdError;
      
    } else {
      // PostgreSQL with transaction
      await db.query('BEGIN');
      
      try {
        // Reserve the amount
        await db.query(
          'UPDATE users SET balance = balance - $1 WHERE id = $2',
          [amount, userId]
        );
        
        // Create transaction
        const reference = `XTX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const txResultResult = await db.query(
          `INSERT INTO transactions 
           (user_id, amount, currency, type, status, reference, description, account_details) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            userId, 
            -amount, 
            user.currency, 
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
              username: user.username
            })
          ]
        );
        
        const txRows = txResultResult[0];
        txResult = txRows && txRows.length > 0 ? txRows[0] : null;
        
        // Generate receipt number
        receiptNumber = `XPR-${Date.now()}-${userId.toString().padStart(6, '0')}`;
        
        // Create withdrawal request
        await db.query(
          `INSERT INTO withdrawal_requests 
           (user_id, transaction_id, amount, currency, bank_name, bank_code, 
            account_number, account_name, status, receipt_number) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            userId,
            txResult.id,
            amount,
            user.currency,
            bank_name,
            bank_code,
            account_number,
            account_name,
            'pending',
            receiptNumber
          ]
        );
        
        await db.query('COMMIT');
        
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
    
    res.json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      receipt_number: receiptNumber,
      amount,
      status: 'pending_approval'
    });
    
  } catch (error) {
    console.error('Error requesting withdrawal:', error);
    res.status(500).json({ success: false, message: 'Error requesting withdrawal' });
  }
});

// Get bank details
router.get('/bank-details', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    let bankDetails = [];
    
    if (db.isSupabase) {
      const { data, error } = await db.supabase
        .from('user_bank_details')
        .select('bank_details')
        .eq('user_id', userId);
      
      if (!error && data && data.length > 0) {
        bankDetails = data;
      }
    } else {
      const bankDetailsResult = await db.query(
        'SELECT * FROM user_bank_details WHERE user_id = $1',
        [userId]
      );
      
      const bankDetailsRows = bankDetailsResult[0];
      bankDetails = bankDetailsRows || [];
    }
    
    res.json({
      success: true,
      bank_details: bankDetails.length > 0 ? 
        (db.isSupabase ? JSON.parse(bankDetails[0].bank_details) : JSON.parse(bankDetails[0].bank_details)) 
        : null
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
    
    if (db.isSupabase) {
      // Check if already exists
      const { data: existing, error: checkError } = await db.supabase
        .from('user_bank_details')
        .select('id')
        .eq('user_id', userId);
      
      if (checkError) throw checkError;
      
      if (existing && existing.length > 0) {
        // Update
        const { error } = await db.supabase
          .from('user_bank_details')
          .update({ 
            bank_details: JSON.stringify(bankDetails),
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);
        
        if (error) throw error;
      } else {
        // Insert
        const { error } = await db.supabase
          .from('user_bank_details')
          .insert([{
            user_id: userId,
            bank_details: JSON.stringify(bankDetails)
          }]);
        
        if (error) throw error;
      }
    } else {
      // Check if already exists
      const existingResult = await db.query(
        'SELECT id FROM user_bank_details WHERE user_id = $1',
        [userId]
      );
      
      const existingRows = existingResult[0];
      const existing = existingRows || [];
      
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

// Set transaction PIN - USING ADMIN CLIENT (BYPASSES RLS)
router.post('/set-pin', authenticateToken, async (req, res) => {
  try {
    const { pin, confirm_pin } = req.body;
    const userId = req.user.id;
    
    console.log('=== SET PIN DEBUG ===');
    console.log('User ID:', userId);
    
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
    
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ 
        success: false, 
        message: 'PIN must be 4 digits' 
      });
    }
    
    const hashedPin = crypto.createHash('sha256').update(pin).digest('hex');
    console.log('Hashed PIN:', hashedPin);
    
    if (db.isSupabase) {
      console.log('Using Supabase admin client...');
      
      // Check if admin client is available
      if (!db.supabaseAdmin) {
        console.error('Admin client not available - check SUPABASE_SERVICE_ROLE_KEY');
        return res.status(500).json({
          success: false,
          message: 'Server configuration error'
        });
      }
      
      // Use admin client to bypass RLS
      const { error } = await db.supabaseAdmin
        .from('users')
        .update({ 
          transaction_pin: hashedPin,
          pin_set_at: new Date().toISOString()
        })
        .eq('id', userId);
      
      if (error) {
        console.error('Admin update error:', error);
        throw error;
      }
      
      console.log('Admin update successful');
      
      // Verify with admin client
      const { data: verifyData } = await db.supabaseAdmin
        .from('users')
        .select('transaction_pin')
        .eq('id', userId)
        .single();
      
      console.log('Verification - PIN set:', !!verifyData?.transaction_pin);
      
    } else {
      // PostgreSQL version
      console.log('Using PostgreSQL...');
      const result = await db.query(
        'UPDATE users SET transaction_pin = $1, pin_set_at = NOW() WHERE id = $2 RETURNING id',
        [hashedPin, userId]
      );
      console.log('PostgreSQL update result:', result);
    }
    
    res.json({
      success: true,
      message: 'Transaction PIN set successfully'
    });
    
  } catch (error) {
    console.error('=== ERROR SETTING TRANSACTION PIN ===');
    console.error('Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error setting transaction PIN',
      debug: error.message 
    });
  }
});
// Verify transaction PIN
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

// Simulate deposit for testing - FIXED VERSION
router.post('/simulate-deposit', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = 'NGN' } = req.body;
    const userId = req.user.id;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid amount' 
      });
    }
    
    const parsedAmount = parseFloat(amount);
    console.log(`Simulating deposit of ${parsedAmount} ${currency} for user ${userId}`);
    
    if (db.isSupabase) {
      // Use admin client to bypass RLS
      if (!db.supabaseAdmin) {
        console.error('Admin client not available');
        return res.status(500).json({
          success: false,
          message: 'Server configuration error'
        });
      }
      
      // Start a transaction by using sequential operations
      // 1. Update user balance using admin client
      const { data: userData, error: userError } = await db.supabaseAdmin
        .from('users')
        .select('balance')
        .eq('id', userId)
        .single();
      
      if (userError) {
        console.error('Error fetching user:', userError);
        throw userError;
      }
      
      const currentBalance = parseFloat(userData?.balance || 0);
      const newBalance = currentBalance + parsedAmount;
      
      const { error: updateError } = await db.supabaseAdmin
        .from('users')
        .update({ balance: newBalance })
        .eq('id', userId);
      
      if (updateError) {
        console.error('Error updating balance:', updateError);
        throw updateError;
      }
      
      // 2. Create transaction record
      const reference = `SIM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const { data: txData, error: txError } = await db.supabaseAdmin
        .from('transactions')
        .insert([{
          user_id: userId,
          amount: parsedAmount,
          currency,
          type: 'deposit',
          status: 'completed',
          reference,
          description: 'Simulated deposit for testing'
        }])
        .select();
      
      if (txError) {
        console.error('Error creating transaction:', txError);
        throw txError;
      }
      
      console.log('Simulated deposit successful');
      
      res.json({
        success: true,
        message: 'Simulated deposit successful',
        amount: parsedAmount,
        new_balance: newBalance,
        transaction_id: txData[0].id
      });
      
    } else {
      // PostgreSQL version with transaction
      await db.query('BEGIN');
      
      try {
        // Update user balance
        await db.query(
          'UPDATE users SET balance = balance + $1 WHERE id = $2',
          [parsedAmount, userId]
        );
        
        // Create transaction record
        const reference = `SIM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const txResult = await db.query(
          `INSERT INTO transactions 
           (user_id, amount, currency, type, status, reference, description) 
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            userId, 
            parsedAmount, 
            currency, 
            'deposit', 
            'completed', 
            reference,
            'Simulated deposit for testing'
          ]
        );
        
        await db.query('COMMIT');
        
        // Get updated balance
        const userResult = await db.query(
          'SELECT balance FROM users WHERE id = $1',
          [userId]
        );
        
        const userRows = userResult[0];
        const user = userRows && userRows.length > 0 ? userRows[0] : null;
        const txRows = txResult[0];
        const transaction = txRows && txRows.length > 0 ? txRows[0] : null;
        
        res.json({
          success: true,
          message: 'Simulated deposit successful',
          amount: parsedAmount,
          new_balance: parseFloat(user.balance),
          transaction_id: transaction.id
        });
        
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
    
  } catch (error) {
    console.error('Error simulating deposit:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error simulating deposit',
      debug: error.message 
    });
  }
});
module.exports = router;