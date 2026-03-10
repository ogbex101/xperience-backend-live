import React from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Trophy, Users, Gamepad2, TrendingUp, Star, Zap } from 'lucide-react'

const Dashboard = () => {
  const { user } = useAuth()

  const stats = [
    {
      icon: Trophy,
      label: 'Tournaments Won',
      value: '0',
      color: 'text-yellow-400'
    },
    {
      icon: Gamepad2,
      label: 'Matches Played',
      value: user?.matches_played || '0',
      color: 'text-blue-400'
    },
    {
      icon: TrendingUp,
      label: 'Win Rate',
      value: user?.win_rate ? `${user.win_rate}%` : '0%',
      color: 'text-green-400'
    },
    {
      icon: Star,
      label: 'Current Rank',
      value: user?.rank || 'E',
      color: 'text-purple-400'
    }
  ]

  const quickActions = [
    {
      title: 'Join Tournament',
      description: 'Compete in live tournaments',
      icon: Trophy,
      link: '/tournaments',
      color: 'bg-purple-500'
    },
    {
      title: 'Create Match',
      description: 'Start a 1v1 challenge',
      icon: Gamepad2,
      link: '/matches/create',
      color: 'bg-blue-500'
    },
    {
      title: 'Find Players',
      description: 'Connect with other gamers',
      icon: Users,
      link: '/players',
      color: 'bg-green-500'
    },
    {
      title: 'My Wallet',
      description: 'Manage your balance',
      icon: Zap,
      link: '/wallet',
      color: 'bg-yellow-500'
    }
  ]

  return (
    <div className="min-h-screen bg-gray-900 py-8">
      <div className="container mx-auto px-4">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Welcome back, <span className="gradient-text">{user?.username}</span>!
          </h1>
          <p className="text-gray-400">
            Ready for your next challenge? Check out the latest tournaments and climb the ranks.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map((stat, index) => {
            const Icon = stat.icon
            return (
              <div key={index} className="card text-center">
                <div className={`w-12 h-12 ${stat.color} bg-opacity-20 rounded-full flex items-center justify-center mx-auto mb-3`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className={stat.color}>{stat.value}</div>
                <div className="text-sm text-gray-400">{stat.label}</div>
              </div>
            )
          })}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {quickActions.map((action, index) => {
            const Icon = action.icon
            return (
              <Link
                key={index}
                to={action.link}
                className="card group hover:border-purple-500 transition-all duration-300"
              >
                <div className={`w-12 h-12 ${action.color} rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{action.title}</h3>
                <p className="text-gray-400 text-sm">{action.description}</p>
              </Link>
            )
          })}
        </div>

        {/* Recent Activity & Live Tournaments */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Activity */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Recent Activity</h2>
            <div className="space-y-4">
              <div className="text-center py-8">
                <Gamepad2 className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No recent activity</p>
                <p className="text-sm text-gray-500 mt-1">Join your first tournament to get started!</p>
              </div>
            </div>
          </div>

          {/* Live Tournaments */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Live Tournaments</h2>
            <div className="space-y-4">
              <div className="text-center py-8">
                <Trophy className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No live tournaments</p>
                <Link 
                  to="/tournaments" 
                  className="btn-primary mt-3 inline-block"
                >
                  Browse Tournaments
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Progress Section */}
        <div className="card mt-8">
          <h2 className="text-xl font-semibold text-white mb-4">Rank Progress</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Current Rank</span>
              <span className="text-purple-400 font-semibold">{user?.rank || 'E'} Rank</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div 
                className="bg-purple-gradient h-3 rounded-full transition-all duration-1000"
                style={{ width: '0%' }} // You'll calculate this based on rank progress
              ></div>
            </div>
            <p className="text-sm text-gray-400 text-center">
              Play more matches to advance to the next rank!
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard