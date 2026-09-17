package config

import (
	"errors"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Listen, Origin, DatabaseURL, RedisURL, RPCURL, Mint, AuthorityFile, MerchantKey string
}

func Load() (Config, error) {
	c := Config{
		Listen: value("LISTEN_ADDR", "127.0.0.1:8080"), Origin: value("APP_ORIGIN", "http://localhost:5173"),
		DatabaseURL: os.Getenv("DATABASE_URL"), RedisURL: os.Getenv("REDIS_URL"),
		RPCURL: value("SOLANA_RPC_URL", "https://api.devnet.solana.com"), Mint: os.Getenv("SOLANA_MINT"),
		AuthorityFile: os.Getenv("SOLANA_AUTHORITY_KEYPAIR"), MerchantKey: os.Getenv("MERCHANT_API_KEY"),
	}
	if c.DatabaseURL == "" || c.RedisURL == "" {
		return c, errors.New("DATABASE_URL and REDIS_URL are required; copy server/.env.example to server/.env")
	}
	u, err := url.Parse(c.Origin)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))) {
		return c, errors.New("APP_ORIGIN must be an HTTPS origin or local HTTP origin, without a trailing slash")
	}
	if (c.Mint == "") != (c.AuthorityFile == "") {
		return c, errors.New("SOLANA_MINT and SOLANA_AUTHORITY_KEYPAIR must be configured together")
	}
	if c.MerchantKey != "" && len(c.MerchantKey) < 32 {
		return c, errors.New("MERCHANT_API_KEY must contain at least 32 characters")
	}
	if strings.HasPrefix(c.RPCURL, "http:") && !strings.HasPrefix(c.RPCURL, "http://127.0.0.1:") && !strings.HasPrefix(c.RPCURL, "http://localhost:") {
		return c, errors.New("remote RPC requires HTTPS")
	}
	return c, nil
}

func value(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
