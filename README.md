# Statly Backend API

> RESTful API powering the Statly productivity tracking platform

---

## About

The **Statly Backend** is a robust Node.js/Express API that powers the Statly productivity analytics platform. It handles user authentication, TickTick data synchronization, focus record management, statistics calculation, and the challenges/achievements system.

Built with TypeScript for type safety and deployed as serverless functions on Vercel, the backend provides a scalable, secure foundation for transforming TickTick productivity data into actionable insights.

---

## Tech Stack

**Runtime & Framework**
- **Node.js** - JavaScript runtime
- **Express.js 4** - Web application framework
- **TypeScript** - Type-safe JavaScript

**Database**
- **MongoDB** - NoSQL document database
- **Mongoose 8** - Elegant MongoDB object modeling

**Authentication & Security**
- **JWT (JSON Web Tokens)** - Stateless authentication
- **bcryptjs** - Password hashing and encryption

**Cloud Services**
- **Cloudinary** - Image upload and management
- **Vercel** - Serverless deployment platform
- **MongoDB Atlas** - Cloud database hosting

**Development Tools**
- **Nodemon** - Auto-restart development server
- **ESLint** - Code quality and linting
- **ts-node** - TypeScript execution for development

---

## API Overview

The Statly API provides comprehensive endpoints for managing productivity data:

### User Authentication & Management
- User registration and login
- JWT-based session management
- Password encryption and security
- User profile management
- Account settings and preferences

### TickTick Integration
- Secure TickTick data synchronization
- Focus time record import and processing
- Task and project data mapping
- Automatic data updates and syncing
- Privacy-focused, read-only integration

### Focus Records
- CRUD operations for focus sessions
- Advanced filtering and querying
- Date range analysis
- Tag and project-based organization
- Focus quality metrics

### Task Management
- Completed task tracking
- Task-to-focus record association
- Project hierarchy management
- Task metadata and statistics
- Completion time tracking

### Statistics & Analytics
- Real-time productivity statistics
- Aggregated focus time calculations
- Trend analysis and insights
- Calendar heatmap data generation
- Custom date range queries

### Challenges System
- Custom challenge creation and management
- Streak tracking and validation
- Progress monitoring and updates
- Challenge completion detection
- Difficulty level management

### Achievements & Medals
- Medal/achievement tracking
- Milestone detection and unlocking
- Achievement rarity tiers
- Progress toward locked achievements
- User achievement history

### User Settings & Customization
- Theme and color preferences
- Custom image uploads via Cloudinary
- Display settings management
- Data visibility preferences
- Import/export settings

---

## Key Features

**Secure Authentication**
- JWT-based stateless authentication
- Bcrypt password hashing (10 salt rounds)
- Protected routes with middleware
- Token expiration and refresh handling

**TickTick Synchronization**
- Automated data import from TickTick
- Focus time record processing
- Task and project synchronization
- Incremental sync for efficiency
- Data transformation and normalization

**Real-Time Statistics**
- On-demand statistics calculation
- Aggregation pipeline optimization
- Caching for frequently accessed data
- Efficient database queries
- Multiple time range support

**Image Management**
- Cloudinary integration for uploads
- Image optimization and transformation
- Organized folder structure
- Secure upload handling with Multer
- CDN delivery for performance

**Data Filtering & Querying**
- Advanced MongoDB queries
- Flexible filtering options
- Date range support
- Tag and project filtering
- Pagination for large datasets

---

## Database Models

The API uses the following core data models:

**User**
- Authentication credentials (email, hashed password)
- Profile information
- JWT token management
- Account settings and preferences

**FocusRecord**
- Focus session data from TickTick
- Duration and timestamp information
- Associated tasks and projects
- Tags and custom metadata
- Emotion tracking data

**Task**
- Task details and metadata
- Completion status and timestamps
- Focus time associations
- Project relationships
- Priority and complexity data

**Project**
- Project hierarchies and organization
- Task groupings
- Analytics aggregations
- Custom metadata

**Challenge**
- User-created challenges
- Goal definitions and targets
- Streak tracking
- Completion status
- Difficulty levels

**Achievement**
- Medal/achievement definitions
- Unlock conditions
- Rarity tiers
- User progress tracking

**UserSettings**
- Theme and appearance preferences
- Custom images and assets
- Display settings
- Data visibility options

---

## Architecture

**Serverless Deployment**
- Deployed on Vercel as serverless functions
- Automatic scaling based on demand
- Cold start optimization
- Environment variable management

**Database Layer**
- MongoDB Atlas cloud hosting
- Connection pooling for efficiency
- Replica sets for high availability
- Automated backups and recovery

**API Design**
- RESTful principles
- JSON request/response format
- Consistent error handling
- HTTP status code standards
- API versioning support

**Code Organization**
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
│   └── index.ts        # Request handler
├── scripts/            # Utility and maintenance scripts
└── tsconfig.json       # TypeScript configuration
```

**Middleware Stack**
- CORS for cross-origin requests
- Compression for response optimization
- JSON body parsing
- Authentication verification
- Error handling and logging

---

## Development & Deployment

**Local Development**
- TypeScript compilation with ts-node
- Nodemon for automatic restarts
- Environment-based configuration (.env files)
- MongoDB local or Atlas connection

**Production**
- TypeScript compilation to JavaScript
- Vercel serverless deployment
- MongoDB Atlas production database
- Environment variable management
- Automated CI/CD pipeline

**Code Quality**
- ESLint for code linting
- TypeScript strict mode
- Prettier for code formatting
- Consistent coding standards

---

## Security Considerations

- **Password Security**: Bcrypt hashing with salt rounds
- **Token Management**: JWT with expiration and secure signing
- **Data Encryption**: HTTPS for all data transmission
- **Input Validation**: Request validation and sanitization
- **Error Handling**: Secure error messages (no sensitive data leakage)
- **Environment Variables**: Sensitive data in environment config
- **CORS Configuration**: Controlled cross-origin access

---

## Related Projects

- **[Statly Frontend](../statly)** - React-based web application

---

Built with Node.js, Express, and MongoDB for scalable, serverless productivity tracking.
