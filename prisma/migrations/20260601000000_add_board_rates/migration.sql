-- CreateEnum
CREATE TYPE "BoardType" AS ENUM ('ROOM_ONLY', 'BREAKFAST', 'HALF_BOARD', 'FULL_BOARD', 'ALL_INCLUSIVE');

-- CreateTable
CREATE TABLE "room_board_rates" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "board" "BoardType" NOT NULL,
    "price" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_board_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_board_rates_roomId_idx" ON "room_board_rates"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "room_board_rates_roomId_board_key" ON "room_board_rates"("roomId", "board");

-- AddForeignKey
ALTER TABLE "room_board_rates" ADD CONSTRAINT "room_board_rates_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
