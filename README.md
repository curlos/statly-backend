# Statly Backend API

> RESTful API powering the Statly productivity tracking platform

---

## About

The **Statly Backend** is a production-grade Node.js/Express API powering the Statly productivity analytics platform. Built with advanced MongoDB patterns, complex timezone-aware algorithms, and ML integration, it transforms multi-source productivity data into actionable insights. Deployed as serverless functions on Vercel with TypeScript for type safety, the backend handles everything from real-time analytics and intelligent data processing to distributed sync operations and sentiment analysis.

---

## Tech Stack

- **Node.js** + **TypeScript** + **Express.js 4** - Server runtime and web framework
- **MongoDB** with **Mongoose 8** - NoSQL document database and ODM
- **JWT** + **bcryptjs** - Stateless authentication and password hashing
- **Cloudinary** - Image upload and management
- **Vercel** - Serverless deployment platform
- **MongoDB Atlas** - Cloud database hosting

---

## Key Features

**Serverless Architecture**
- Deployed on Vercel with automatic scaling
- Cold start optimization for serverless functions
- Environment-based configuration management

**TickTick Integration**
- Secure, read-only data synchronization
- Focus time record import and processing
- Task and project data mapping
- Incremental sync for efficiency

**Authentication & Security**
- JWT-based stateless authentication
- Bcrypt password hashing (10 salt rounds)
- HTTPS encryption for all data transmission
- Protected routes with middleware

**Real-Time Analytics**
- On-demand statistics calculation
- MongoDB aggregation pipeline optimization
- Calendar heatmap data generation
- Multiple time range support (day/week/month/year)

**Image Management**
- Cloudinary integration for user uploads
- Image optimization and transformation
- Secure upload handling with Multer
- CDN delivery for performance

---

## Advanced Features

**Data Architecture**
- Mongoose discriminator pattern for multi-source data normalization
- Compound indexing strategy with userId-first optimization
- Service layer architecture (Route → Controller → Service → Utils → Models)

**Complex Algorithms**
- Multi-ring streak calculation with timezone awareness and grace periods
- Midnight-crossing focus record splitting with duration attribution
- Batched bulk operations with MongoDB 16MB BSON limit handling

**Integrations & Performance**
- HuggingFace sentiment analysis for emotion detection
- Distributed sync lock mechanism for concurrent operation prevention
- Parallel aggregation pipelines using $facet for single-roundtrip queries

---

## Architecture

**Deployment**
- Serverless functions on Vercel with automatic scaling
- MongoDB Atlas for cloud database hosting with replica sets
- Connection pooling for database efficiency

**API Design**
- RESTful principles with JSON request/response
- Modular code organization (routes/controllers/models/middleware)
- Consistent error handling and HTTP status codes
- CORS configuration for cross-origin access

**Code Structure**
```
statly-backend/
├── src/
│   ├── models/         # Mongoose schemas and models
│   ├── routes/         # Express route definitions
│   ├── middleware/     # Auth, validation, error handling
│   ├── controllers/    # Business logic and handlers
│   ├── utils/          # Helper functions and utilities
│   └── app.ts          # Express app configuration
├── api/                # Vercel serverless entry point
└── scripts/            # Utility and maintenance scripts
```

---

## Related Projects

- **[Statly Frontend](../statly)** - React-based web application

---

Built with Node.js, Express, and MongoDB for scalable, serverless productivity tracking.
