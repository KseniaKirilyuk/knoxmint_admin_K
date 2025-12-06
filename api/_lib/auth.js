import jwt from 'jsonwebtoken';

export function verifyToken(req) {
  const authHeader = req.headers.authorization || req.headers.get?.('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded;
  } catch (error) {
    return null;
  }
}

export function requireAuth(req) {
  const user = verifyToken(req);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return user;
}
