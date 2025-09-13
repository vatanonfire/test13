import { VercelRequest, VercelResponse } from '@vercel/node';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables first
dotenv.config();

// Import routes with error handling
let authRoutes, userRoutes, coinRoutes, ritualRoutes, aiChatRoutes, fortuneRoutes, notificationRoutes, fortuneLimitsRoutes, adminRoutes;

try {
  authRoutes = require('../src/routes/auth').default;
  userRoutes = require('../src/routes/user').default;
  coinRoutes = require('../src/routes/coins').default;
  ritualRoutes = require('../src/routes/rituals').default;
  aiChatRoutes = require('../src/routes/ai-chat').default;
  fortuneRoutes = require('../src/routes/fortune').default;
  notificationRoutes = require('../src/routes/notifications').default;
  fortuneLimitsRoutes = require('../src/routes/fortuneLimits').default;
  adminRoutes = require('../src/routes/admin').default;
} catch (error) {
  console.error('Route import error:', error);
}

const app = express();

// Enhanced CORS configuration for Vercel
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'https://*.vercel.app',
      'https://*.vercel.com',
      'https://*.netlify.app',
      'https://*.netlify.com'
    ];
    
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin.includes('*')) {
        return origin.includes(allowedOrigin.replace('*', ''));
      }
      return origin === allowedOrigin;
    });
    
    callback(null, isAllowed);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Body parsing middleware with comprehensive validation
app.use(express.json({ 
  limit: '50mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '50mb' 
}));

// Request validation middleware
app.use((req, res, next) => {
  // Validate URL length
  if (req.url && req.url.length > 2048) {
    return res.status(414).json({
      success: false,
      message: 'URL too long',
      error: 'URL_TOO_LONG'
    });
  }

  // Validate request headers
  const userAgent = req.headers['user-agent'];
  if (!userAgent || userAgent.length > 512) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user agent',
      error: 'MALFORMED_REQUEST_HEADER'
    });
  }

  // Validate content type for POST/PUT requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
    const contentType = req.headers['content-type'];
    if (!contentType || (!contentType.includes('application/json') && !contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded'))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content type',
        error: 'MALFORMED_REQUEST_HEADER'
      });
    }
  }

  next();
});

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Rate limiting middleware
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per window

app.use((req, res, next) => {
  const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  if (!rateLimitMap.has(clientIP)) {
    rateLimitMap.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }
  
  const clientData = rateLimitMap.get(clientIP);
  
  if (now > clientData.resetTime) {
    clientData.count = 1;
    clientData.resetTime = now + RATE_LIMIT_WINDOW;
    return next();
  }
  
  if (clientData.count >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests',
      error: 'FUNCTION_THROTTLED',
      retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
    });
  }
  
  clientData.count++;
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Fal Platform Backend is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '1.0.0'
  });
});

// API Routes with error handling
if (authRoutes) app.use('/api/auth', authRoutes);
if (userRoutes) app.use('/api/user', userRoutes);
if (coinRoutes) app.use('/api/coins', coinRoutes);
if (ritualRoutes) app.use('/api/rituals', ritualRoutes);
if (aiChatRoutes) app.use('/api/ai-chat', aiChatRoutes);
if (fortuneRoutes) app.use('/api/fortune', fortuneRoutes);
if (notificationRoutes) app.use('/api/notifications', notificationRoutes);
if (fortuneLimitsRoutes) app.use('/api/fortune-limits', fortuneLimitsRoutes);
if (adminRoutes) app.use('/api/admin', adminRoutes);

// Global error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('API Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
    userAgent: req.headers['user-agent'],
    ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress
  });
  
  // Handle specific error types
  let statusCode = err.status || 500;
  let errorCode = 'INTERNAL_FUNCTION_INVOCATION_FAILED';
  let message = 'Internal server error';
  
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'MALFORMED_REQUEST_HEADER';
    message = 'Validation error';
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
    message = 'Unauthorized';
  } else if (err.name === 'ForbiddenError') {
    statusCode = 403;
    errorCode = 'FORBIDDEN';
    message = 'Forbidden';
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
    errorCode = 'RESOURCE_NOT_FOUND';
    message = 'Resource not found';
  } else if (err.name === 'TimeoutError') {
    statusCode = 504;
    errorCode = 'FUNCTION_INVOCATION_TIMEOUT';
    message = 'Request timeout';
  } else if (err.name === 'PayloadTooLargeError') {
    statusCode = 413;
    errorCode = 'FUNCTION_PAYLOAD_TOO_LARGE';
    message = 'Payload too large';
  }
  
  res.status(statusCode).json({
    success: false,
    message: message,
    error: errorCode,
    ...(process.env.NODE_ENV === 'development' && { 
      details: err.message,
      stack: err.stack 
    })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Vercel serverless function handler with comprehensive error handling
export default async (req: VercelRequest, res: VercelResponse) => {
  // Set response timeout
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        message: 'Function timeout',
        error: 'FUNCTION_INVOCATION_TIMEOUT'
      });
    }
  }, 25000); // 25 saniye timeout (Vercel limit 30s)

  try {
    // Validate request method
    if (!req.method || !['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'].includes(req.method)) {
      clearTimeout(timeout);
      return res.status(405).json({
        success: false,
        message: 'Method not allowed',
        error: 'INVALID_REQUEST_METHOD'
      });
    }

    // Set CORS headers for Vercel
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      clearTimeout(timeout);
      return res.status(200).end();
    }

    // Validate request size
    const contentLength = req.headers['content-length'];
    if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) { // 50MB limit
      clearTimeout(timeout);
      return res.status(413).json({
        success: false,
        message: 'Payload too large',
        error: 'FUNCTION_PAYLOAD_TOO_LARGE'
      });
    }

    // Process the request with Express app
    await new Promise((resolve, reject) => {
      app(req, res, (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });

    clearTimeout(timeout);
    
  } catch (error) {
    clearTimeout(timeout);
    
    console.error('Vercel function error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Function execution error',
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'FUNCTION_INVOCATION_FAILED'
      });
    }
  }
};
