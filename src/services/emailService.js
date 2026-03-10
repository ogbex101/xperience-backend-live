const nodemailer = require('nodemailer');
const db = require('../config/database');

class EmailService {
  constructor() {
    this.transporter = null;
    this.init();
  }

  async init() {
    if (process.env.SMTP_ENABLED === 'true') {
      try {
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: parseInt(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD
          },
          tls: {
            rejectUnauthorized: false
          }
        });

        // Verify connection
        await this.transporter.verify();
        console.log('✅ Email service connected successfully');
      } catch (error) {
        console.error('❌ Email service connection failed:', error.message);
        console.log('⚠️ Email notifications will be logged but not sent');
      }
    } else {
      console.log('⚠️ Email service disabled (SMTP_ENABLED=false)');
    }
  }

  /**
   * Log email to database
   */
  async logEmail(to, subject, status, messageId = null, error = null) {
    try {
      const emailLog = {
        recipient: Array.isArray(to) ? to.join(', ') : to,
        subject: subject,
        status: status,
        message_id: messageId,
        error: error,
        sent_at: new Date().toISOString()
      };

      if (db.isSupabase) {
        const { error: dbError } = await db.supabaseBuilder('email_logs')
          .insert([emailLog]);
        
        if (dbError) console.error('Failed to log email:', dbError);
      } else {
        // Fallback to PostgreSQL
        const keys = Object.keys(emailLog);
        const values = Object.values(emailLog);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        
        await db.pool.query(
          `INSERT INTO email_logs (${keys.join(', ')}) VALUES (${placeholders})`,
          values
        );
      }
    } catch (logError) {
      console.error('Failed to log email:', logError);
      // Don't throw - logging failure shouldn't break email sending
    }
  }

  async sendEmail(to, subject, html, text = '') {
    const mailOptions = {
      from: `"${process.env.SMTP_FROM_NAME || 'Xperience Platform'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: subject,
      html: html,
      text: text || html.replace(/<[^>]*>/g, '')
    };

    try {
      if (this.transporter) {
        const info = await this.transporter.sendMail(mailOptions);
        console.log('📧 Email sent:', info.messageId);
        
        // Log successful email
        await this.logEmail(to, subject, 'sent', info.messageId);
        
        return { success: true, messageId: info.messageId };
      } else {
        // Log email instead of sending
        console.log('📧 Email would be sent (simulation):', { to, subject });
        
        // Log simulated email
        await this.logEmail(to, subject, 'simulated');
        
        return { success: true, simulated: true };
      }
    } catch (error) {
      console.error('❌ Email send error:', error.message);
      
      // Log failed email
      await this.logEmail(to, subject, 'failed', null, error.message);
      
      return { success: false, error: error.message };
    }
  }

  async sendToUsers(userEmails, subject, message) {
    const results = [];
    const emails = Array.isArray(userEmails) ? userEmails : [userEmails];
    
    for (const email of emails) {
      const result = await this.sendEmail(
        email,
        subject,
        `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; background-color: #f4f4f4; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { margin: 0; font-size: 28px; }
            .header p { margin: 5px 0 0; opacity: 0.9; }
            .content { padding: 30px 20px; color: #333; line-height: 1.6; }
            .content h2 { color: #444; margin-top: 0; }
            .content p { margin: 0 0 15px; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #eee; }
            .footer a { color: #667eea; text-decoration: none; }
            .button { display: inline-block; padding: 10px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; margin-top: 15px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚀 Xperience Platform</h1>
              <p>Gaming & Tournament System</p>
            </div>
            <div class="content">
              <h2>${subject}</h2>
              <p>${message.replace(/\n/g, '<br>')}</p>
              ${message.includes('verify') || message.includes('confirm') ? 
                '<a href="#" class="button">Take Action</a>' : ''}
            </div>
            <div class="footer">
              <p>This is an automated message from Xperience Platform.</p>
              <p>© ${new Date().getFullYear()} Xperience Platform. All rights reserved.</p>
              <p><a href="#">Unsubscribe</a> | <a href="#">Privacy Policy</a></p>
            </div>
          </div>
        </body>
        </html>
        `,
        `Xperience Platform Notification:\n\n${subject}\n\n${message}\n\nThis is an automated message.`
      );
      
      results.push({ email, success: result.success, messageId: result.messageId });
    }
    
    return results;
  }

  /**
   * Get email logs from database
   */
  async getEmailLogs(filters = {}) {
    try {
      let logs = [];
      
      if (db.isSupabase) {
        let query = db.supabaseBuilder('email_logs')
          .select('*')
          .order('sent_at', { ascending: false });
        
        if (filters.status) {
          query = query.eq('status', filters.status);
        }
        
        if (filters.recipient) {
          query = query.ilike('recipient', `%${filters.recipient}%`);
        }
        
        if (filters.limit) {
          query = query.limit(parseInt(filters.limit));
        }
        
        const { data, error } = await query;
        if (error) throw error;
        logs = data;
      } else {
        let query = 'SELECT * FROM email_logs';
        const params = [];
        const conditions = [];
        
        if (filters.status) {
          conditions.push(`status = $${params.length + 1}`);
          params.push(filters.status);
        }
        
        if (filters.recipient) {
          conditions.push(`recipient ILIKE $${params.length + 1}`);
          params.push(`%${filters.recipient}%`);
        }
        
        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ' ORDER BY sent_at DESC';
        
        if (filters.limit) {
          query += ` LIMIT $${params.length + 1}`;
          params.push(parseInt(filters.limit));
        }
        
        const result = await db.pool.query(query, params);
        logs = result.rows;
      }
      
      return { success: true, logs };
    } catch (error) {
      console.error('Failed to fetch email logs:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send templated emails
   */
  async sendTemplatedEmail(to, template, data = {}) {
    const templates = {
      welcome: {
        subject: 'Welcome to Xperience Platform! 🎮',
        html: (data) => `
          <h2>Welcome ${data.username || 'Gamer'}!</h2>
          <p>We're excited to have you join the Xperience gaming community!</p>
          <p>Get started by:</p>
          <ul>
            <li>Completing your profile</li>
            <li>Joining tournaments</li>
            <li>Connecting with other gamers</li>
          </ul>
          <a href="${data.verifyLink || '#'}" class="button">Verify Email</a>
        `
      },
      passwordReset: {
        subject: 'Password Reset Request',
        html: (data) => `
          <h2>Reset Your Password</h2>
          <p>Click the button below to reset your password. This link expires in 1 hour.</p>
          <a href="${data.resetLink}" class="button">Reset Password</a>
          <p>If you didn't request this, please ignore this email.</p>
        `
      },
      tournamentStarted: {
        subject: `Tournament Started: ${data.tournamentName}`,
        html: (data) => `
          <h2>🏟️ Tournament Started!</h2>
          <p>The tournament "${data.tournamentName}" has begun!</p>
          <p>Check your bracket and start competing!</p>
          <a href="${data.tournamentLink}" class="button">View Tournament</a>
        `
      }
    };

    const selectedTemplate = templates[template];
    if (!selectedTemplate) {
      return { success: false, error: 'Template not found' };
    }

    const html = selectedTemplate.html(data);
    const text = html.replace(/<[^>]*>/g, '');

    return this.sendEmail(to, selectedTemplate.subject, html, text);
  }
}

// Create the email_logs table if it doesn't exist (for PostgreSQL fallback)
const createEmailLogsTable = async () => {
  if (!db.isSupabase && db.pool) {
    try {
      await db.pool.query(`
        CREATE TABLE IF NOT EXISTS email_logs (
          id SERIAL PRIMARY KEY,
          recipient TEXT NOT NULL,
          subject TEXT NOT NULL,
          status VARCHAR(50) NOT NULL,
          message_id TEXT,
          error TEXT,
          sent_at TIMESTAMP DEFAULT NOW()
        );
      `);
      console.log('✅ Email logs table verified');
    } catch (error) {
      console.error('Failed to create email_logs table:', error);
    }
  } else if (db.isSupabase) {
    // Note: You'll need to create this table manually in Supabase
    console.log('📧 Email logging enabled - ensure email_logs table exists in Supabase');
  }
};

// Initialize table on startup
createEmailLogsTable();

module.exports = new EmailService();