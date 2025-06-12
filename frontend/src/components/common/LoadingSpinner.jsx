export default function LoadingSpinner({ text = '加载中...' }) {
  return (
    <div className="loading-spinner">
      <div className="spinner" />
      <span>{text}</span>
    </div>
  );
}
