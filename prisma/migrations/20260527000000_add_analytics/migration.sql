-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('WHATSAPP_CLICK', 'BOOKING_CTA_CLICK', 'HOTEL_VIEW', 'SIGNUP', 'LOGIN', 'BOOKING_STARTED', 'BOOKING_COMPLETED', 'SEARCH');

-- CreateTable
CREATE TABLE "analytics_pageviews" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "path" TEXT NOT NULL,
    "fullUrl" TEXT,
    "referrer" TEXT,
    "referrerSrc" TEXT,
    "ua" TEXT,
    "deviceType" TEXT,
    "country" TEXT,
    "ipHash" TEXT,
    "lang" TEXT,
    "sessionId" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_pageviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_sessions" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "pageviewCount" INTEGER NOT NULL DEFAULT 1,
    "entryPath" TEXT NOT NULL,
    "exitPath" TEXT,
    "country" TEXT,
    "referrerSrc" TEXT,
    "deviceType" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "analytics_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "type" "AnalyticsEventType" NOT NULL,
    "path" TEXT NOT NULL,
    "meta" JSONB,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_daily_stats" (
    "date" DATE NOT NULL,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
    "uniqueUsers" INTEGER NOT NULL DEFAULT 0,
    "bookingsCreated" INTEGER NOT NULL DEFAULT 0,
    "bookingsConfirmed" INTEGER NOT NULL DEFAULT 0,
    "avgPageviewsPerSession" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "topPaths" JSONB,
    "topCountries" JSONB,
    "topReferrerSrcs" JSONB,
    "topDevices" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_daily_stats_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "analytics_pageviews_visitorId_createdAt_idx" ON "analytics_pageviews"("visitorId", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_pageviews_sessionId_idx" ON "analytics_pageviews"("sessionId");

-- CreateIndex
CREATE INDEX "analytics_pageviews_createdAt_idx" ON "analytics_pageviews"("createdAt");

-- CreateIndex
CREATE INDEX "analytics_pageviews_path_idx" ON "analytics_pageviews"("path");

-- CreateIndex
CREATE INDEX "analytics_pageviews_country_idx" ON "analytics_pageviews"("country");

-- CreateIndex
CREATE INDEX "analytics_sessions_visitorId_startedAt_idx" ON "analytics_sessions"("visitorId", "startedAt");

-- CreateIndex
CREATE INDEX "analytics_sessions_startedAt_idx" ON "analytics_sessions"("startedAt");

-- CreateIndex
CREATE INDEX "analytics_sessions_country_idx" ON "analytics_sessions"("country");

-- CreateIndex
CREATE INDEX "analytics_events_type_createdAt_idx" ON "analytics_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_sessionId_idx" ON "analytics_events"("sessionId");

-- CreateIndex
CREATE INDEX "analytics_events_visitorId_createdAt_idx" ON "analytics_events"("visitorId", "createdAt");
