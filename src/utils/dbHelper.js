// backend/utils/dbHelper.js - POSTGRESQL VERSION
const prepareQueryParams = (params) => {
  return params.map((param, index) => {
    if (param === undefined) {
      return null;
    }
    if (typeof param === 'object' && param !== null && !(param instanceof Date)) {
      return JSON.stringify(param);
    }
    return param;
  });
};

// Generate PostgreSQL parameter placeholders ($1, $2, etc.)
const generatePlaceholders = (count) => {
  return Array.from({ length: count }, (_, i) => `$${i + 1}`).join(', ');
};

// Convert MySQL query with ? to PostgreSQL with $ placeholders
const convertToPostgreSQL = (mysqlQuery, paramCount) => {
  let pgQuery = mysqlQuery;
  for (let i = 1; i <= paramCount; i++) {
    pgQuery = pgQuery.replace('?', `$${i}`);
  }
  return pgQuery;
};

module.exports = { 
  prepareQueryParams,
  generatePlaceholders,
  convertToPostgreSQL 
};

// Usage example:
/*
const { prepareQueryParams, convertToPostgreSQL } = require('./dbHelper');

async function notifyFriendsOfActivity(userId, activityData) {
  const mysqlQuery = `
    INSERT INTO friend_activities (user_id, friend_id, activity_type, activity_data, created_at)
    SELECT ?, friends.friend_id, ?, ?, NOW()
    FROM friends 
    WHERE friends.user_id = ? AND friends.status = 'accepted'
  `;

  const params = prepareQueryParams([
    userId,
    activityData.type,
    activityData.data,
    userId
  ]);

  // Convert to PostgreSQL
  const pgQuery = convertToPostgreSQL(mysqlQuery, params.length);

  try {
    await db.query(pgQuery, params); // Use .query() not .execute()
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}
*/