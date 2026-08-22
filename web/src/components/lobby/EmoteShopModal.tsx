import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchEmotes, purchaseEmote, type EmoteCatalogItem, type EmoteShopState } from "../../api/emotes";
import { formatPokerAmount } from "../../lib/format";
import { toastFromUnknown } from "../../lib/toast";
import { LottieMount } from "../../table/LottieMount";

type Props = {
  open: boolean;
  onClose: () => void;
  walletBalance: number;
  isMock: boolean;
  showToast: (type: "error" | "success" | "warning", errorType: string, message: string) => void;
  onWalletChange: (wallet: number) => void;
};

export function EmoteShopModal({
  open,
  onClose,
  walletBalance,
  isMock,
  showToast,
  onWalletChange,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [shop, setShop] = useState<EmoteShopState | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchEmotes()
      .then((data) => {
        if (cancelled) {
          return;
        }
        setShop(data);
        if (typeof data.wallet_balance === "number") {
          onWalletChange(data.wallet_balance);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const toast = toastFromUnknown(error);
          showToast("error", toast.errorType || "ShopError", toast.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onWalletChange, open, showToast]);

  if (!open) {
    return null;
  }

  const catalog = shop?.catalog ?? [];
  const owned = new Set(shop?.owned_emote_ids ?? []);
  const wallet = shop?.wallet_balance ?? walletBalance;

  function applyShop(data: EmoteShopState) {
    setShop(data);
    if (typeof data.wallet_balance === "number") {
      onWalletChange(data.wallet_balance);
    }
  }

  async function handleBuy(item: EmoteCatalogItem) {
    if (item.is_default || owned.has(item.emote_id) || busyId) {
      return;
    }
    if (wallet < item.price) {
      const need = Math.max(0, item.price - wallet);
      showToast(
        "error",
        "InsufficientFunds",
        `Нужно ещё ${formatPokerAmount(need)} фишек для «${item.name}»`,
      );
      return;
    }
    setBusyId(item.emote_id);
    try {
      const data = await purchaseEmote(item.emote_id);
      applyShop(data);
      const successText = isMock
        ? `${item.emoji || ""} «${item.name}» куплен! Нажмите «Проверить за столом».`
        : `${item.emoji || ""} «${item.name}» теперь ваш — появится в панели эмодзи за столом.`;
      showToast("success", "PurchaseSuccess", successText.trim());
    } catch (error) {
      const toast = toastFromUnknown(error);
      showToast("error", toast.errorType || "PurchaseFailed", toast.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      id="emote-shop-modal"
      className="pp-modal-overlay emote-shop-overlay is-open"
      onClick={onClose}
    >
      <div
        className="pp-modal-panel emote-shop-panel"
        role="dialog"
        aria-labelledby="emote-shop-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="emote-shop-header">
          <h2 id="emote-shop-title">Магазин эмодзи</h2>
          <p className="emote-shop-subtitle">
            Купите эксклюзивные эмодзи — они появятся за столом только у вас
          </p>
          <div className="emote-shop-balance">
            <span>Ваш баланс:</span>
            <strong id="emote-shop-balance-amount">{formatPokerAmount(wallet)}</strong>
            <span className="pp-chip-icon" aria-hidden="true" />
          </div>
        </header>
        <div className="emote-shop-body">
          <div id="emote-shop-grid" className="emote-shop-grid">
            {loading ? (
              <div className="emote-shop-loading">Загрузка магазина...</div>
            ) : (
              catalog.map((item) => {
                const isOwned = owned.has(item.emote_id);
                const isDefault = Boolean(item.is_default);
                const canAfford = wallet >= item.price;
                const iconClass = item.style_class
                  ? `emote-shop-card__icon ${item.style_class}`
                  : "emote-shop-card__icon";
                const cardClass = [
                  "emote-shop-card",
                  isOwned ? "is-owned" : "",
                  isDefault ? "is-default" : "",
                  !isOwned && !isDefault && !canAfford ? "is-locked" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <article key={item.emote_id} className={cardClass}>
                    {item.lottie_url ? (
                      <LottieMount
                        url={item.lottie_url}
                        className={`${iconClass} emote-shop-card__icon--lottie`}
                        fallback={item.emoji}
                      />
                    ) : (
                      <div className={iconClass}>{item.emoji}</div>
                    )}
                    <div className="emote-shop-card__name">{item.name}</div>
                    {isDefault ? (
                      <span className="emote-shop-card__price is-free">Базовое</span>
                    ) : (
                      <span className="emote-shop-card__price">
                        {formatPokerAmount(item.price)} <span className="pp-chip-icon" />
                      </span>
                    )}
                    {isDefault ? (
                      <button
                        type="button"
                        className="emote-shop-card__action emote-shop-card__action--free"
                        disabled
                      >
                        Бесплатно
                      </button>
                    ) : isOwned ? (
                      <button
                        type="button"
                        className="emote-shop-card__action emote-shop-card__action--owned"
                        disabled
                      >
                        Куплено
                      </button>
                    ) : !canAfford ? (
                      <button
                        type="button"
                        className="emote-shop-card__action emote-shop-card__action--buy"
                        onClick={() => void handleBuy(item)}
                      >
                        Не хватает
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="emote-shop-card__action emote-shop-card__action--buy"
                        disabled={Boolean(busyId)}
                        onClick={() => void handleBuy(item)}
                      >
                        {busyId === item.emote_id ? "Покупка..." : "Купить"}
                      </button>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </div>
        <footer className="emote-shop-footer">
          {isMock ? (
            <Link
              to="/dev-table"
              className="pp-btn pp-btn-purple emote-shop-test-table"
              title="Только купленные эмодзи"
            >
              Проверить за столом
            </Link>
          ) : null}
          <button type="button" className="pp-btn pp-btn-ghost emote-shop-close" onClick={onClose}>
            Закрыть
          </button>
        </footer>
      </div>
    </div>
  );
}