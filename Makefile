.PHONY: install infra dev server check-all integration
install:
	bun install
	cd server && go mod download
infra:
	docker compose up -d --wait
dev:
	bun run dev
server:
	cd server && go run ./cmd/api
check-all:
	bun run check
	bun run --cwd client test
	bun run --cwd tools test
	bun run build
	cd server && test -z "$$(gofmt -l .)" && go vet ./... && go test -race ./... && go build ./...
integration:
	cd server && INTEGRATION_TEST=1 go test -race ./internal/api -count=1 -v
